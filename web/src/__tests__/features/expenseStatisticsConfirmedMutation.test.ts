import { clearClientSessionScope, setClientSessionScope, type ClientSessionScope } from '@/composition/clientSessionScope';
import { resetLoadedClientSessionState } from '@/composition/clientSessionResetRegistry';
import { ledgerCommands } from '@/features/ledger/application/ledgerCommands';
import { loadExpenseStatistics, peekExpenseStatistics, type ExpenseStatisticsQuery } from '@/platform/reporting/expenseStatisticsCache';
import { getExpenseStatisticsRevision } from '@/platform/reporting/expenseStatisticsInvalidation';
import { readExpenseStatistics } from '@/platform/reporting/expenseStatisticsReadModel';
import type { LedgerTransactionCommandResult } from '@/platform/functions-api/householdCommandContract';
import type { Expense } from '@/types/expense';

const mockExecute = jest.fn();
jest.mock('@/composition/webCommandRuntime', () => ({ getHouseholdCommandClient: () => ({ execute: mockExecute }) }));
jest.mock('@/platform/reporting/expenseStatisticsReadModel', () => ({ readExpenseStatistics: jest.fn() }));
const read = jest.mocked(readExpenseStatistics);
const actor: ClientSessionScope = { principalUid: 'uid', householdId: 'house', memberId: 'member', sessionGeneration: 1 };
const original: Expense = {
  id: 'expense', aggregateVersion: 1, merchant: '가맹점', amount: 12000, date: '2026-09-07',
  transactionType: 'expense', category: 'food', memo: '이전 메모', time: '12:00',
  cardType: 'local_currency', cardLastFour: '경기지역화폐', cardEvidence: '원본 카드', localCurrencyType: 'gyeonggi',
  splitGroupId: 'split-group', splitIndex: 2, splitTotal: 3, splitOriginalId: 'original',
  mergedFrom: [{ merchant: '원본', amount: 12000, category: 'food' }], mergeLeafIds: ['leaf'],
};
const other: Expense = { id: 'other', aggregateVersion: 1, merchant: '다른 거래', amount: 3000, date: '2026-08-01', category: 'food' };
const confirmed: LedgerTransactionCommandResult = {
  transactionId: original.id, householdId: actor.householdId, transactionType: 'expense',
  merchant: original.merchant, memo: original.memo!, amountInWon: original.amount, categoryId: original.category,
  accountingDate: original.date, localTime: '12:00', cardDisplay: '서버 카드 표시', cardType: 'captured',
  creatorMemberId: actor.memberId, lifecycleState: 'active', aggregateVersion: 2,
};
const query = (overrides: Partial<ExpenseStatisticsQuery> = {}): ExpenseStatisticsQuery => ({
  scope: actor, revision: getExpenseStatisticsRevision(), remoteReadEpoch: 0,
  startDate: '2026-01-01', endDate: '2026-12-31', ...overrides,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
async function prime(rows: Expense[] = [original, other], overrides: Partial<ExpenseStatisticsQuery> = {}) {
  read.mockResolvedValueOnce(rows);
  await loadExpenseStatistics(query(overrides));
}
beforeEach(() => {
  jest.useRealTimers();
  mockExecute.mockReset();
  read.mockReset();
  setClientSessionScope(actor);
  resetLoadedClientSessionState();
});
afterEach(() => { resetLoadedClientSessionState(); clearClientSessionScope(); jest.useRealTimers(); });

it.each([
  { name: '메모', patch: { memo: '확인된 메모' }, response: { memo: '확인된 메모' } },
  { name: '카테고리', patch: { category: 'living' }, response: { categoryId: 'LIVING' } },
  { name: '메모와 카테고리', patch: { memo: '확인된 메모', category: 'living' }, response: { memo: '확인된 메모', categoryId: 'LIVING' } },
  { name: '전용 카테고리 명령', patch: undefined, response: { categoryId: 'LIVING' } },
])('$name 확인 응답으로 상세값과 기간/카테고리 합계를 갱신하며 추가 조회하지 않는다', async ({ patch, response }) => {
  await prime();
  const before = getExpenseStatisticsRevision();
  mockExecute.mockResolvedValueOnce({ ...confirmed, ...response });
  if (patch) await ledgerCommands.update(actor.householdId, original.id, 1, patch, true);
  else await ledgerCommands.changeCategory(actor.householdId, original.id, 'living', 1);
  expect(getExpenseStatisticsRevision()).toBe(before + 1);
  const updated = { ...original, memo: response.memo ?? original.memo, category: response.categoryId ? 'living' : 'food', aggregateVersion: 2 };
  expect(peekExpenseStatistics(query())).toEqual([updated, other]);
  const rows = await loadExpenseStatistics(query());
  expect(rows.reduce((sum, expense) => sum + expense.amount, 0)).toBe(15000);
  expect(rows.filter(expense => expense.category === updated.category).reduce((sum, expense) => sum + expense.amount, 0))
    .toBe(updated.category === 'living' ? 12000 : 15000);
  expect(await loadExpenseStatistics(query({ startDate: '2026-09-01', endDate: '2026-09-30' }))).toEqual([updated]);
  expect(original).toMatchObject({ memo: '이전 메모', category: 'food', aggregateVersion: 1 });
  expect(read).toHaveBeenCalledTimes(1);
  expect(mockExecute).toHaveBeenCalledTimes(1);
});

it.each<Partial<Expense>>([
  { amount: 12000 }, { date: '2026-09-07' }, { merchant: '가맹점' }, {},
  { memo: '메모', amount: 12000 }, { category: 'living', merchant: '가맹점' },
])('메모/카테고리 전용이 아닌 실제 patch %o는 전체 무효화를 유지한다', async patch => {
  await prime();
  mockExecute.mockResolvedValueOnce(confirmed);
  await ledgerCommands.update(actor.householdId, original.id, 1, patch);
  expect(peekExpenseStatistics(query())).toBeUndefined();
  await prime();
  expect(read).toHaveBeenCalledTimes(2);
});

it.each<Partial<LedgerTransactionCommandResult>>([
  { transactionId: 'other-id' }, { householdId: 'other-house' }, { lifecycleState: 'deleted' },
  { transactionType: 'income' }, { aggregateVersion: 1 }, { aggregateVersion: 3 },
  { aggregateVersion: Number.NaN }, { merchant: '변경된 상호' }, { amountInWon: 13000 },
  { accountingDate: '2026-09-08' }, { categoryId: '' },
])('확인 응답의 범위/상태/버전/변경 필드를 증명할 수 없으면 전체 무효화한다: %o', async change => {
  await prime();
  mockExecute.mockResolvedValueOnce({ ...confirmed, memo: '확인된 메모', ...change });
  await ledgerCommands.update(actor.householdId, original.id, 1, { memo: '메모' });
  expect(peekExpenseStatistics(query())).toBeUndefined();
});

it.each([
  { name: '범위 내 항목 없음', rows: [other] },
  { name: '이전 버전 불일치', rows: [{ ...original, aggregateVersion: 2 }] },
  { name: '중복 ID', rows: [original, original] },
])('$name이면 완료 원본을 보존하지 않는다', async ({ rows }) => {
  await prime(rows);
  mockExecute.mockResolvedValueOnce({ ...confirmed, memo: '확인된 메모' });
  await ledgerCommands.update(actor.householdId, original.id, 1, { memo: '메모' });
  expect(peekExpenseStatistics(query())).toBeUndefined();
});

it('모든 완료범위를 증명할 수 없는 서로 다른 기간은 기존 전체 무효화를 유지한다', async () => {
  await prime();
  await prime([], { startDate: '2025-01-01', endDate: '2025-12-31' });
  mockExecute.mockResolvedValueOnce({ ...confirmed, memo: '확인된 메모' });
  await ledgerCommands.update(actor.householdId, original.id, 1, { memo: '메모' });
  expect(peekExpenseStatistics(query())).toBeUndefined();
  expect(peekExpenseStatistics(query({ startDate: '2025-01-01', endDate: '2025-12-31' }))).toBeUndefined();
});

it('복귀 검증 read가 진행 중이면 전체 무효화하고 늦은 이전 read로 최신값을 덮지 않는다', async () => {
  await prime();
  const previous = deferred<Expense[]>();
  read.mockReturnValueOnce(previous.promise);
  const oldRead = loadExpenseStatistics(query(), true);
  const obsolete = expect(oldRead).rejects.toThrow('STATISTICS_SESSION_CHANGED');
  mockExecute.mockResolvedValueOnce({ ...confirmed, memo: '확인된 메모' });
  await ledgerCommands.update(actor.householdId, original.id, 1, { memo: '메모' });
  expect(peekExpenseStatistics(query())).toBeUndefined();
  const latest = [{ ...original, aggregateVersion: 2, memo: '확인된 메모' }, { ...other, amount: 9000 }];
  await prime(latest);
  previous.resolve([original, other]);
  await obsolete;
  expect(peekExpenseStatistics(query())).toEqual(latest);
  expect(read).toHaveBeenCalledTimes(3);
});

it('확인 응답으로 receivedAt을 연장하지 않고 원래 60초 TTL에 서버 원본을 갱신한다', async () => {
  jest.useFakeTimers().setSystemTime(0);
  await prime();
  jest.setSystemTime(59000);
  mockExecute.mockResolvedValueOnce({ ...confirmed, memo: '확인된 메모' });
  await ledgerCommands.update(actor.householdId, original.id, 1, { memo: '메모' });
  await loadExpenseStatistics(query());
  expect(read).toHaveBeenCalledTimes(1);
  jest.setSystemTime(60001);
  const latest = [{ ...original, aggregateVersion: 3, memo: '다른 기기의 최신 메모' }];
  read.mockResolvedValueOnce(latest);
  expect(await loadExpenseStatistics(query())).toEqual(latest);
  expect(read).toHaveBeenCalledTimes(2);
});

it('페이지 외부 수정 후 재진입 force는 확인 캐시를 보여주면서 서버 최신성을 다시 검증한다', async () => {
  await prime();
  mockExecute.mockResolvedValueOnce({ ...confirmed, memo: '확인된 메모' });
  await ledgerCommands.update(actor.householdId, original.id, 1, { memo: '메모' });
  expect(peekExpenseStatistics(query())?.[0].memo).toBe('확인된 메모');
  const latest = [{ ...original, aggregateVersion: 3, memo: '최신 메모' }];
  read.mockResolvedValueOnce(latest);
  expect(await loadExpenseStatistics(query(), true)).toEqual(latest);
  expect(read).toHaveBeenCalledTimes(2);
});

it('실패한 명령은 완료 원본이나 revision을 바꾸지 않는다', async () => {
  await prime();
  const before = getExpenseStatisticsRevision();
  mockExecute.mockRejectedValueOnce(new Error('실패'));
  await expect(ledgerCommands.update(actor.householdId, original.id, 1, { memo: '미확정' })).rejects.toThrow('실패');
  expect(getExpenseStatisticsRevision()).toBe(before);
  expect(await loadExpenseStatistics(query())).toEqual([original, other]);
  expect(read).toHaveBeenCalledTimes(1);
});

it('순서대로 확인한 수정은 이전 확인 버전을 바탕으로 최신 상세값을 이어간다', async () => {
  await prime();
  mockExecute.mockResolvedValueOnce({ ...confirmed, memo: '첫 메모' });
  await ledgerCommands.update(actor.householdId, original.id, 1, { memo: '첫 메모' });
  mockExecute.mockResolvedValueOnce({ ...confirmed, aggregateVersion: 3, memo: '둘째 메모', categoryId: 'living' });
  await ledgerCommands.update(actor.householdId, original.id, 2, { memo: '둘째 메모', category: 'living' });
  expect((await loadExpenseStatistics(query()))[0]).toEqual({ ...original, aggregateVersion: 3, memo: '둘째 메모', category: 'living' });
  expect(read).toHaveBeenCalledTimes(1);
});

it('응답이 역순으로 도착하면 더 높은 버전 캐시에 늦은 확인값을 적용하지 않는다', async () => {
  await prime();
  const older = deferred<LedgerTransactionCommandResult>();
  const newer = deferred<LedgerTransactionCommandResult>();
  mockExecute.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  const first = ledgerCommands.update(actor.householdId, original.id, 1, { memo: '오래된 확인값' });
  const second = ledgerCommands.update(actor.householdId, original.id, 2, { memo: '최신 확인값' });
  newer.resolve({ ...confirmed, aggregateVersion: 3, memo: '최신 확인값' });
  await second;
  expect(peekExpenseStatistics(query())).toBeUndefined();
  const latest = [{ ...original, aggregateVersion: 3, memo: '최신 확인값' }];
  await prime(latest);
  older.resolve({ ...confirmed, memo: '오래된 확인값' });
  await first;
  expect(peekExpenseStatistics(query())).toBeUndefined();
  await prime(latest);
  expect(peekExpenseStatistics(query())).toEqual(latest);
});

it.each<Partial<ClientSessionScope>>([
  { principalUid: 'next-uid' }, { memberId: 'next-member' }, { householdId: 'next-house' },
  { sessionGeneration: 2 }, { accessMode: 'administrator-readonly' },
])('이전 actor의 확인값을 전환된 캐시에 적용하거나 무효화하지 않는다: %o', async change => {
  await prime();
  const completion = deferred<LedgerTransactionCommandResult>();
  mockExecute.mockReturnValueOnce(completion.promise);
  const command = ledgerCommands.update(actor.householdId, original.id, 1, { memo: '이전 actor' });
  const nextActor = { ...actor, ...change };
  setClientSessionScope(nextActor);
  resetLoadedClientSessionState();
  const next = [{ ...original, memo: '새 actor 값' }];
  await prime(next, { scope: nextActor });
  const before = getExpenseStatisticsRevision();
  completion.resolve({ ...confirmed, memo: '이전 actor' });
  await command;
  expect(getExpenseStatisticsRevision()).toBe(before);
  expect(peekExpenseStatistics(query({ scope: nextActor }))).toEqual(next);
});

it('부분 갱신 후에도 epoch가 다른 캐시를 표시하지 않고 실패를 기존 epoch 값으로 대체하지 않는다', async () => {
  await prime();
  mockExecute.mockResolvedValueOnce({ ...confirmed, memo: '확인된 메모' });
  await ledgerCommands.update(actor.householdId, original.id, 1, { memo: '메모' });
  const next = query({ remoteReadEpoch: 1 });
  expect(peekExpenseStatistics(next)).toBeUndefined();
  read.mockRejectedValueOnce(new Error('새 epoch 실패'));
  await expect(loadExpenseStatistics(next)).rejects.toThrow('새 epoch 실패');
  expect(peekExpenseStatistics(next)).toBeUndefined();
  expect(peekExpenseStatistics(query())).toBeUndefined();
});

it('같은 actor의 세션 reset도 부분 갱신 완료값을 모두 폐기한다', async () => {
  await prime();
  mockExecute.mockResolvedValueOnce({ ...confirmed, memo: '확인된 메모' });
  await ledgerCommands.update(actor.householdId, original.id, 1, { memo: '메모' });
  resetLoadedClientSessionState();
  expect(peekExpenseStatistics(query())).toBeUndefined();
  await prime([other]);
  expect(peekExpenseStatistics(query())).toEqual([other]);
});
