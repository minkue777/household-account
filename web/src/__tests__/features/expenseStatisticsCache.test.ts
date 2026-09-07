import { loadExpenseStatistics, peekExpenseStatistics, type ExpenseStatisticsQuery } from '@/platform/reporting/expenseStatisticsCache';
import { readExpenseStatistics } from '@/platform/reporting/expenseStatisticsReadModel';
import { getExpenseStatisticsRevision, invalidateExpenseStatistics } from '@/platform/reporting/expenseStatisticsInvalidation';
import { setClientSessionScope, type ClientSessionScope } from '@/composition/clientSessionScope';
import { resetLoadedClientSessionState } from '@/composition/clientSessionResetRegistry';
import type { Expense } from '@/types/expense';

jest.mock('@/platform/reporting/expenseStatisticsReadModel', () => ({ readExpenseStatistics: jest.fn() }));
const read = jest.mocked(readExpenseStatistics);
const actor: ClientSessionScope = { principalUid: 'uid', memberId: 'member', householdId: 'house', sessionGeneration: 1 };
const row = (id: string, date: string, amount = 10): Expense => ({ id, date, amount, aggregateVersion: 1, merchant: id, category: 'food' });
const query = (overrides: Partial<ExpenseStatisticsQuery> = {}): ExpenseStatisticsQuery => ({
  scope: actor, remoteReadEpoch: 0, revision: getExpenseStatisticsRevision(), startDate: '2025-10-01', endDate: '2026-09-30', ...overrides,
});
function deferred() {
  let resolve!: (expenses: Expense[]) => void;
  const promise = new Promise<Expense[]>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  jest.useRealTimers();
  read.mockReset();
  setClientSessionScope(actor);
  resetLoadedClientSessionState();
});

it('one completed year supplies exact 3/6-month and contained custom periods with zero further source reads', async () => {
  const rows = [row('winter', '2026-02-01', 0), row('spring', '2026-04-01', 20), row('summer', '2026-07-01', 30)];
  read.mockResolvedValue(rows);
  await loadExpenseStatistics(query());
  const threeMonths = query({ startDate: '2026-07-01' });
  expect(peekExpenseStatistics(threeMonths)).toEqual([rows[2]]);
  expect(await loadExpenseStatistics(threeMonths)).toEqual([rows[2]]);
  expect(await loadExpenseStatistics(query({ startDate: '2026-04-01' }))).toEqual(rows.slice(1));
  expect(await loadExpenseStatistics(query({ startDate: '2026-02-01', endDate: '2026-02-28' }))).toEqual([rows[0]]);
  expect(read).toHaveBeenCalledTimes(1);
});

it('a period switch joins the covering in-flight year and never publishes an incomplete total', async () => {
  const work = deferred();
  read.mockReturnValue(work.promise);
  const year = loadExpenseStatistics(query());
  const short = query({ startDate: '2026-07-01' });
  const quarter = loadExpenseStatistics(short);
  expect(peekExpenseStatistics(short)).toBeUndefined();
  expect(read).toHaveBeenCalledTimes(1);
  work.resolve([row('earlier', '2026-02-01'), row('now', '2026-09-01')]);
  expect(await year).toHaveLength(2);
  expect(await quarter).toEqual([row('now', '2026-09-01')]);
});

it.each([
  { principalUid: 'other' }, { memberId: 'other' }, { householdId: 'other' },
  { sessionGeneration: 2 }, { accessMode: 'administrator-readonly' as const },
])('does not reuse or reinsert a completed reply after actor dimension changes: %o', async change => {
  const work = deferred();
  read.mockReturnValueOnce(work.promise).mockResolvedValueOnce([row('new', '2026-09-01', 20)]);
  const old = query();
  const first = loadExpenseStatistics(old);
  const assertion = expect(first).rejects.toThrow('STATISTICS_SESSION_CHANGED');
  const nextActor = { ...actor, ...change };
  setClientSessionScope(nextActor);
  const next = query({ scope: nextActor });
  expect(peekExpenseStatistics(next)).toBeUndefined();
  await loadExpenseStatistics(next);
  work.resolve([row('old', '2026-09-01', 999)]);
  await assertion;
  expect(peekExpenseStatistics(next)).toEqual([row('new', '2026-09-01', 20)]);
  expect(peekExpenseStatistics(old)).toBeUndefined();
});

it.each(['reset', 'mutation', 'epoch'] as const)('purges pending ownership on %s so late results cannot refill the cache', async kind => {
  const work = deferred();
  read.mockReturnValueOnce(work.promise).mockResolvedValueOnce([]);
  const first = loadExpenseStatistics(query());
  const assertion = expect(first).rejects.toThrow('STATISTICS_SESSION_CHANGED');
  if (kind === 'reset') resetLoadedClientSessionState();
  if (kind === 'mutation') invalidateExpenseStatistics();
  const next = query({ remoteReadEpoch: kind === 'epoch' ? 1 : 0 });
  await loadExpenseStatistics(next);
  work.resolve([row('stale', '2026-09-01', 999)]);
  await assertion;
  expect(peekExpenseStatistics(next)).toEqual([]);
});

it('retains complete data while revalidating on re-entry/resume, but does not cache failure as empty success', async () => {
  read.mockResolvedValueOnce([row('old', '2026-09-01')]).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
  const year = query();
  await loadExpenseStatistics(year);
  const short = query({ startDate: '2026-07-01' });
  await expect(loadExpenseStatistics(short, true)).rejects.toThrow('offline');
  expect(peekExpenseStatistics(short)).toEqual([row('old', '2026-09-01')]);
  expect(read.mock.calls[1].slice(0, 2)).toEqual(['2025-10-01', '2026-09-30']);
  expect(await loadExpenseStatistics(short, true)).toEqual([]);
  expect(peekExpenseStatistics(year)).toEqual([]);
});

it('refreshes an expired covering range and keeps a different custom range bounded', async () => {
  jest.useFakeTimers().setSystemTime(0);
  read.mockResolvedValue([]);
  await loadExpenseStatistics(query());
  jest.setSystemTime(60_001);
  await loadExpenseStatistics(query({ startDate: '2026-07-01' }));
  expect(read).toHaveBeenCalledTimes(2);
  expect(read.mock.calls[1].slice(0, 2)).toEqual(['2025-10-01', '2026-09-30']);
  await loadExpenseStatistics(query({ startDate: '2024-01-01', endDate: '2024-03-31' }));
  expect(read.mock.calls[2].slice(0, 2)).toEqual(['2024-01-01', '2024-03-31']);
  jest.useRealTimers();
});

it('a late overlapping custom range cannot replace the newer completed source', async () => {
  const older = deferred();
  const newer = deferred();
  read.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  const january = query({ startDate: '2026-01-01', endDate: '2026-06-30' });
  const april = query({ startDate: '2026-04-01', endDate: '2026-09-30' });
  const first = loadExpenseStatistics(january);
  const rejected = expect(first).rejects.toThrow('STATISTICS_SESSION_CHANGED');
  const second = loadExpenseStatistics(april);
  newer.resolve([row('current', '2026-05-01', 20)]);
  await second;
  older.resolve([row('old', '2026-05-01', 999)]);
  await rejected;
  expect(peekExpenseStatistics(april)).toEqual([row('current', '2026-05-01', 20)]);
  expect(peekExpenseStatistics(january)).toBeUndefined();
});

it('a cached period switch joins an ongoing resume refresh and receives its latest values', async () => {
  const refresh = deferred();
  read.mockResolvedValueOnce([row('old', '2026-09-01', 10)]).mockReturnValueOnce(refresh.promise);
  await loadExpenseStatistics(query());
  const pendingYear = loadExpenseStatistics(query(), true);
  const short = query({ startDate: '2026-07-01' });
  expect(peekExpenseStatistics(short)).toEqual([row('old', '2026-09-01', 10)]);
  let settled = false;
  const pendingShort = loadExpenseStatistics(short).then(result => { settled = true; return result; });
  await Promise.resolve();
  expect(settled).toBe(false);
  refresh.resolve([row('new', '2026-09-01', 20)]);
  await pendingYear;
  expect(await pendingShort).toEqual([row('new', '2026-09-01', 20)]);
  expect(read).toHaveBeenCalledTimes(2);
});
