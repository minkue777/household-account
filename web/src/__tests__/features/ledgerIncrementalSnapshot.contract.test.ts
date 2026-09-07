import { subscribeToMonthlyTransactions, subscribeToDateRangeExpenses, mapDocToExpense } from '@/lib/expenseService';
import { ledgerOptimisticProjection } from '@/features/ledger/application/ledgerOptimisticProjection';
import { isVisibleLedgerReadDocument } from '@/features/ledger/application/ledgerReadVisibility';
import type { Expense } from '@/types/expense';
import type { DocumentData, QueryDocumentSnapshot } from '@/platform/read-model/firestoreReadModel';

const mockOnSnapshot = jest.fn();
let mockHouseholdId = 'house';
jest.mock('@/composition/clientSessionScope', () => ({ requireClientSessionScope: () => ({ householdId: mockHouseholdId }) }));
jest.mock('@/platform/read-model/firestoreReadModel', () => ({
  db: {}, collection: jest.fn(), query: jest.fn(), where: jest.fn(),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
}));

function document(id: string, fields: DocumentData = {}) {
  return {
    id,
    data: jest.fn(() => ({ householdId: mockHouseholdId, date: '2026-09-07', time: '12:00',
      merchant: id, amount: 100, categoryId: 'food', aggregateVersion: 1, lifecycleState: 'active', ...fields })),
  };
}
type TestDocument = ReturnType<typeof document>;
type Change = { type: 'added' | 'modified' | 'removed'; doc: TestDocument };
function event(docs: TestDocument[], changes: Change[] = [], fromCache = false) {
  return { docs, metadata: { fromCache }, docChanges: jest.fn(() => changes) };
}
function listen(kind: 'month' | 'range', callback: (items: Expense[]) => void) {
  const dispose = kind === 'month'
    ? subscribeToMonthlyTransactions(2026, 9, callback)
    : subscribeToDateRangeExpenses('2026-01-01', '2026-12-31', callback);
  const args = mockOnSnapshot.mock.calls.at(-1)!;
  return { dispose, next: args[kind === 'month' ? 2 : 1] as (value: ReturnType<typeof event>) => void };
}
beforeEach(() => {
  mockHouseholdId = 'house';
  mockOnSnapshot.mockReset().mockReturnValue(jest.fn());
  ledgerOptimisticProjection.reset();
});
afterEach(() => ledgerOptimisticProjection.reset());

it.each(['month', 'range'] as const)('%s: one changed row in 1,000 decodes one document and preserves all other references', kind => {
  const rows = Array.from({ length: 1000 }, (_, index) => document(`row-${index}`));
  const renders: Expense[][] = [];
  const source = listen(kind, items => renders.push(items));
  source.next(event(rows));
  const previous = renders.at(-1)!;
  const changed = document('row-500', { memo: '수정', amount: 150, categoryId: 'living', aggregateVersion: 2 });
  const nextRows = rows.map(row => row.id === changed.id ? changed : row);
  // The old full-snapshot path is retained here as an independent result/cost comparison.
  nextRows.forEach(row => row.data.mockClear());
  const oldResult = nextRows.filter(row => isVisibleLedgerReadDocument(row.data()))
    .map(row => mapDocToExpense(row as unknown as QueryDocumentSnapshot<DocumentData>));
  expect(nextRows.reduce((sum, row) => sum + row.data.mock.calls.length, 0)).toBe(2000);
  nextRows.forEach(row => row.data.mockClear());
  source.next(event(nextRows, [{ type: 'modified', doc: changed }]));
  expect(nextRows.reduce((sum, row) => sum + row.data.mock.calls.length, 0)).toBe(1);
  const actual = renders.at(-1)!;
  expect(actual).toHaveLength(1000);
  expect(new Map(actual.map(row => [row.id, row]))).toEqual(new Map(oldResult.map(row => [row.id, row])));
  expect(actual.find(row => row.id === 'row-499')).toBe(previous.find(row => row.id === 'row-499'));
  expect(actual[0].id).toBe('row-999');
  source.dispose();
});

it('seeds all first server documents after ignored cache events even when docChanges is empty', () => {
  const cached = document('cached', { amount: 999 });
  const confirmed = document('confirmed');
  const callback = jest.fn();
  const source = listen('month', callback);
  source.next(event([cached], [{ type: 'added', doc: cached }], true));
  expect(callback).not.toHaveBeenCalled();
  expect(cached.data).not.toHaveBeenCalled();
  source.next(event([confirmed]));
  expect(callback).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'confirmed', amount: 100 })]);
  expect(confirmed.data).toHaveBeenCalledTimes(1);
});

it('still publishes metadata-only confirmations without re-decoding documents', () => {
  const row = document('row');
  const callback = jest.fn();
  const source = listen('month', callback);
  source.next(event([row]));
  const previous = callback.mock.calls.at(-1)![0][0];
  callback.mockClear();
  row.data.mockClear();
  source.next(event([row], [], true));
  source.next(event([row]));
  expect(callback).toHaveBeenCalledTimes(2);
  expect(callback.mock.calls.at(-1)![0][0]).toBe(previous);
  expect(row.data).not.toHaveBeenCalled();
});

it.each(['month', 'range'] as const)('%s: applies added, modified, hidden, moved and removed documents as one complete event', kind => {
  const a = document('a');
  const hidden = document('hidden', { lifecycleState: 'superseded' });
  const restored = document('hidden', { memo: '복원', aggregateVersion: 2 });
  const invisible = document('a', { lifecycleState: 'deleted', aggregateVersion: 2 });
  const added = document('added', { date: '2026-09-08' });
  const callback = jest.fn();
  const source = listen(kind, callback);
  source.next(event([a, hidden]));
  callback.mockClear();
  source.next(event([invisible, restored, added], [
    { type: 'modified', doc: invisible }, { type: 'added', doc: added }, { type: 'modified', doc: restored },
  ]));
  expect(callback).toHaveBeenCalledTimes(1);
  expect(callback.mock.calls[0][0].map((row: Expense) => row.id)).toEqual(['added', 'hidden']);
  const outside = document('added', { date: '2027-01-01', aggregateVersion: 2 });
  source.next(event([invisible, restored], [{ type: 'removed', doc: outside }]));
  expect(outside.data).not.toHaveBeenCalled();
  expect(callback).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'hidden', memo: '복원' })]);
});

it('does not use aggregateVersion as a substitute for Firestore document changes', () => {
  const callback = jest.fn();
  const source = listen('month', callback);
  source.next(event([document('row')]));
  const repaired = document('row', { memo: '동일 버전 보정', cardDisplay: '국민(1234)' });
  source.next(event([repaired], [{ type: 'modified', doc: repaired }]));
  expect(callback).toHaveBeenLastCalledWith([expect.objectContaining({ memo: '동일 버전 보정', cardLastFour: '국민(1234)' })]);
});

it('rebuilds after a failed event so its changes are recovered even when absent from the next delta', () => {
  const callback = jest.fn();
  const source = listen('month', callback);
  source.next(event([document('row')]));
  const changed = document('row', { amount: 200 });
  const broken = document('broken');
  broken.data.mockImplementation(() => { throw new Error('decode failed'); });
  expect(() => source.next(event([changed, broken], [
    { type: 'modified', doc: changed }, { type: 'added', doc: broken },
  ]))).toThrow('decode failed');
  expect(callback).toHaveBeenLastCalledWith([expect.objectContaining({ amount: 100 })]);
  const repaired = document('broken', { memo: '복구됨' });
  source.next(event([changed, repaired], [{ type: 'modified', doc: repaired }]));
  expect(callback).toHaveBeenLastCalledWith(expect.arrayContaining([
    expect.objectContaining({ id: 'row', amount: 200 }),
    expect.objectContaining({ id: 'broken', memo: '복구됨' }),
  ]));
  source.dispose();
  mockHouseholdId = 'other-house';
  const other = jest.fn();
  const otherSource = listen('month', other);
  otherSource.next(event([]));
  expect(other).toHaveBeenLastCalledWith([]);
});
