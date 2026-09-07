import {
  clearClientSessionScope,
  setClientSessionScope,
  type ClientSessionScope,
} from '@/composition/clientSessionScope';
import { resetLoadedClientSessionState } from '@/composition/clientSessionResetRegistry';
import { ledgerCommands } from '@/features/ledger/application/ledgerCommands';
import {
  getExpenseStatisticsRevision,
  subscribeExpenseStatisticsInvalidation,
} from '@/platform/reporting/expenseStatisticsInvalidation';
import {
  ledgerMergedTransactionId,
  type HouseholdCommandName,
  type LedgerTransactionCommandResult,
} from '@/platform/functions-api/householdCommandContract';

const mockExecute = jest.fn();

jest.mock('@/composition/webCommandRuntime', () => ({
  getHouseholdCommandClient: () => ({ execute: mockExecute }),
}));

const actor: ClientSessionScope = {
  principalUid: 'principal-1',
  memberId: 'member-1',
  householdId: 'house-1',
  sessionGeneration: 1,
  accessMode: 'member',
};

const transaction: LedgerTransactionCommandResult = {
  transactionId: 'expense-1',
  householdId: actor.householdId,
  transactionType: 'expense',
  merchant: '가맹점',
  memo: '',
  amountInWon: 12_000,
  categoryId: 'food',
  accountingDate: '2026-09-07',
  localTime: '12:00',
  cardDisplay: '수동',
  cardType: 'manual',
  creatorMemberId: actor.memberId,
  lifecycleState: 'active',
  aggregateVersion: 2,
};

const splitResult = { transactionIds: ['split-1', 'split-2'], splitGroupId: 'split-group-1' };
const expectedVersions = { 'expense-1': 1, 'expense-2': 1 };

const mutations: {
  name: string;
  command: HouseholdCommandName;
  invoke: () => Promise<unknown>;
  result: unknown;
}[] = [
  {
    name: '수동 거래 추가',
    command: 'ledger.record-manual-transaction.v1',
    invoke: () => ledgerCommands.record(actor.householdId, {
      merchant: '가맹점', amount: 12_000, category: 'food', date: '2026-09-07',
      transactionType: 'expense',
    }),
    result: transaction,
  },
  {
    name: '거래 수정',
    command: 'ledger.update-transaction.v1',
    invoke: () => ledgerCommands.update(actor.householdId, 'expense-1', 1, { amount: 13_000 }),
    result: transaction,
  },
  {
    name: '거래 삭제',
    command: 'ledger.delete-transaction.v1',
    invoke: () => ledgerCommands.delete(actor.householdId, 'expense-1', 1),
    result: { ...transaction, lifecycleState: 'deleted' },
  },
  {
    name: '카테고리 변경',
    command: 'ledger.change-transaction-category.v1',
    invoke: () => ledgerCommands.changeCategory(actor.householdId, 'expense-1', 'living', 1),
    result: transaction,
  },
  {
    name: '수동 월 분할 추가',
    command: 'ledger.record-manual-monthly-split.v1',
    invoke: () => ledgerCommands.recordMonthlySplit(actor.householdId, {
      merchant: '가맹점', amountInWon: 12_000, categoryId: 'food',
      accountingDate: '2026-09-07', months: 2,
    }),
    result: splitResult,
  },
  {
    name: '기존 거래 월 분할',
    command: 'ledger.split-existing-transaction-monthly.v1',
    invoke: () => ledgerCommands.splitExistingMonthly(actor.householdId, 'expense-1', 1, 2),
    result: splitResult,
  },
  {
    name: '항목 분할',
    command: 'ledger.split-transaction.v1',
    invoke: () => ledgerCommands.split(actor.householdId, 'expense-1', 1, [
      { merchant: '항목 1', amount: 6_000, category: 'food' },
      { merchant: '항목 2', amount: 6_000, category: 'living' },
    ]),
    result: splitResult,
  },
  {
    name: '거래 병합',
    command: 'ledger.merge-transactions.v1',
    invoke: () => ledgerCommands.merge(actor.householdId, 'expense-1', 1, 'expense-2', 1, 'merge-command'),
    result: { transactionId: ledgerMergedTransactionId('merge-command') },
  },
  {
    name: '병합 복원',
    command: 'ledger.unmerge-transaction.v1',
    invoke: () => ledgerCommands.unmerge(actor.householdId, 'expense-1', 1),
    result: { transactionIds: ['expense-1', 'expense-2'] },
  },
  {
    name: '항목 분할 복원',
    command: 'ledger.restore-item-split.v1',
    invoke: () => ledgerCommands.restoreItemSplit(actor.householdId, 'original-1', expectedVersions),
    result: { transactionId: 'original-1' },
  },
  {
    name: '월 분할 취소',
    command: 'ledger.cancel-monthly-split.v1',
    invoke: () => ledgerCommands.cancelMonthlySplit(actor.householdId, 'split-group-1', expectedVersions),
    result: { transactionId: 'original-1' },
  },
  {
    name: '월 분할 개월 수 변경',
    command: 'ledger.reconfigure-monthly-split.v1',
    invoke: () => ledgerCommands.reconfigureMonthlySplit(actor.householdId, 'split-group-1', 3, expectedVersions),
    result: { splitGroupId: 'split-group-2' },
  },
];

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe('지출 통계 캐시의 Ledger 명령 무효화', () => {
  let unsubscribe: (() => void) | undefined;

  beforeEach(() => {
    mockExecute.mockReset();
    resetLoadedClientSessionState();
    clearClientSessionScope();
    setClientSessionScope(actor);
  });

  afterEach(() => {
    unsubscribe?.();
    unsubscribe = undefined;
    resetLoadedClientSessionState();
    clearClientSessionScope();
  });

  test.each(mutations)('$name 성공이 확정된 뒤에만 revision과 구독 알림을 한 번 갱신한다', async ({ command, invoke, result }) => {
    const completion = deferred();
    mockExecute.mockReturnValueOnce(completion.promise);
    const listener = jest.fn();
    unsubscribe = subscribeExpenseStatisticsInvalidation(listener);
    const before = getExpenseStatisticsRevision();

    const pending = invoke();

    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledWith(command, expect.any(Object), expect.objectContaining({ householdId: actor.householdId }));
    expect(getExpenseStatisticsRevision()).toBe(before);
    expect(listener).not.toHaveBeenCalled();

    completion.resolve(result);
    await pending;

    expect(getExpenseStatisticsRevision()).toBe(before + 1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test.each(mutations)('$name 실패는 revision이나 구독 알림을 변경하지 않는다', async ({ invoke }) => {
    const failure = new Error('명령 실패');
    mockExecute.mockRejectedValueOnce(failure);
    const listener = jest.fn();
    unsubscribe = subscribeExpenseStatisticsInvalidation(listener);
    const before = getExpenseStatisticsRevision();

    await expect(invoke()).rejects.toBe(failure);

    expect(getExpenseStatisticsRevision()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  test('파트너 알림 요청 성공은 통계 원본을 무효화하지 않는다', async () => {
    mockExecute.mockResolvedValueOnce(transaction);
    const listener = jest.fn();
    unsubscribe = subscribeExpenseStatisticsInvalidation(listener);
    const before = getExpenseStatisticsRevision();

    await ledgerCommands.requestNotification(actor.householdId, 'expense-1', 1);

    expect(mockExecute).toHaveBeenCalledWith('ledger.request-notification.v1', {
      transactionId: 'expense-1', expectedVersion: 1,
    }, { householdId: actor.householdId });
    expect(getExpenseStatisticsRevision()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  test.each<{ name: string; nextActor: ClientSessionScope | undefined }>([
    { name: 'principal', nextActor: { ...actor, principalUid: 'principal-2' } },
    { name: 'member', nextActor: { ...actor, memberId: 'member-2' } },
    { name: 'household', nextActor: { ...actor, householdId: 'house-2' } },
    { name: 'generation', nextActor: { ...actor, sessionGeneration: 2 } },
    { name: 'access mode', nextActor: { ...actor, accessMode: 'administrator-readonly' } },
    { name: '로그아웃', nextActor: undefined },
  ])('$name 전환 전 명령의 늦은 완료가 새 세션의 통계를 무효화하지 않는다', async ({ nextActor }) => {
    const completion = deferred();
    mockExecute.mockReturnValueOnce(completion.promise);
    const pending = ledgerCommands.update(actor.householdId, 'expense-1', 1, { amount: 13_000 });

    resetLoadedClientSessionState();
    clearClientSessionScope();
    if (nextActor) setClientSessionScope(nextActor);
    const listener = jest.fn();
    unsubscribe = subscribeExpenseStatisticsInvalidation(listener);
    const before = getExpenseStatisticsRevision();

    completion.resolve(transaction);
    await pending;

    expect(getExpenseStatisticsRevision()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  test('새 세션의 성공 알림 뒤 이전 세션 명령이 완료되어도 추가 무효화하지 않는다', async () => {
    const oldCompletion = deferred();
    mockExecute.mockReturnValueOnce(oldCompletion.promise);
    const oldPending = ledgerCommands.update(actor.householdId, 'expense-1', 1, { amount: 13_000 });
    resetLoadedClientSessionState();
    clearClientSessionScope();
    const nextActor = { ...actor, memberId: 'member-2', sessionGeneration: 2 };
    setClientSessionScope(nextActor);
    const listener = jest.fn();
    unsubscribe = subscribeExpenseStatisticsInvalidation(listener);
    const before = getExpenseStatisticsRevision();
    mockExecute.mockResolvedValueOnce(transaction);

    await ledgerCommands.delete(nextActor.householdId, 'expense-2', 1);
    expect(getExpenseStatisticsRevision()).toBe(before + 1);
    expect(listener).toHaveBeenCalledTimes(1);

    oldCompletion.resolve(transaction);
    await oldPending;

    expect(getExpenseStatisticsRevision()).toBe(before + 1);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
