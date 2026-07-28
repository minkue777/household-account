import { ledgerCommands } from '@/features/ledger/application/ledgerCommands';
import { ledgerOptimisticProjection } from '@/features/ledger/application/ledgerOptimisticProjection';
import {
  mergeExpenses,
  splitExpense,
  splitExpenseMonthly,
  unmergeExpense,
  updateExpense,
  updateExpenseCategory,
} from '@/lib/expenseService';
import { createHouseholdCommandId } from '@/platform/functions-api/householdCommandClient';
import type { LedgerTransactionCommandResult } from '@/platform/functions-api/householdCommandContract';
import type { Expense } from '@/types/expense';

jest.mock('@/composition/clientSessionScope', () => ({
  requireClientSessionScope: () => ({ householdId: 'house-1', memberId: 'member-1' }),
}));

jest.mock('@/platform/functions-api/householdCommandClient', () => ({
  createHouseholdCommandId: jest.fn(),
}));

jest.mock('@/features/ledger/application/ledgerCommands', () => ({
  ledgerCommands: {
    record: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    changeCategory: jest.fn(),
    recordMonthlySplit: jest.fn(),
    requestNotification: jest.fn(),
    splitExistingMonthly: jest.fn(),
    split: jest.fn(),
    merge: jest.fn(),
    unmerge: jest.fn(),
    cancelMonthlySplit: jest.fn(),
    reconfigureMonthlySplit: jest.fn(),
  },
}));

const mockedCommands = ledgerCommands as jest.Mocked<typeof ledgerCommands>;
const mockedCreateCommandId = createHouseholdCommandId as jest.MockedFunction<
  typeof createHouseholdCommandId
>;

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'expense-1',
    aggregateVersion: 3,
    date: '2026-07-22',
    time: '12:00',
    merchant: 'regional merchant',
    amount: 10_000,
    transactionType: 'expense',
    category: 'etc',
    cardType: 'local_currency',
    cardLastFour: 'regional-card(1234)',
    memo: 'old memo',
    mergedFrom: [{ merchant: 'source', amount: 4_000, category: 'etc' }],
    splitGroupId: 'split-group-1',
    splitIndex: 1,
    splitTotal: 3,
    ...overrides,
  };
}

function commandResult(overrides: Partial<LedgerTransactionCommandResult> = {}) {
  return {
    transactionId: 'expense-1',
    householdId: 'house-1',
    transactionType: 'expense' as const,
    merchant: 'regional merchant',
    memo: 'new memo',
    amountInWon: 10_000,
    categoryId: 'ETC',
    accountingDate: '2026-07-22',
    localTime: '12:00',
    cardDisplay: 'server-captured-card(9999)',
    cardType: 'captured' as const,
    creatorMemberId: 'member-1',
    lifecycleState: 'active' as const,
    aggregateVersion: 4,
    ...overrides,
  } satisfies LedgerTransactionCommandResult;
}

describe('ledger expense service optimistic canonical contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateCommandId.mockReturnValue('merge-command-default');
    ledgerOptimisticProjection.reset();
  });

  afterEach(() => {
    ledgerOptimisticProjection.reset();
  });

  test('update response preserves UI provenance and split/merge metadata absent from the command result', async () => {
    const rendered: Expense[][] = [];
    const subscription = ledgerOptimisticProjection.subscribe(
      (items) => rendered.push(items),
      () => true,
      'house-1'
    );
    subscription.publish([expense()]);
    mockedCommands.update.mockResolvedValue(commandResult());

    await updateExpense('expense-1', { memo: 'new memo' }, 3);

    expect(rendered.at(-1)?.[0]).toMatchObject({
      aggregateVersion: 4,
      memo: 'new memo',
      cardType: 'local_currency',
      cardLastFour: 'regional-card(1234)',
      splitGroupId: 'split-group-1',
      splitIndex: 1,
      splitTotal: 3,
      mergedFrom: [{ merchant: 'source', amount: 4_000, category: 'etc' }],
    });
  });

  test('category response preserves the same provenance while applying authoritative category/version', async () => {
    const rendered: Expense[][] = [];
    const subscription = ledgerOptimisticProjection.subscribe(
      (items) => rendered.push(items),
      () => true,
      'house-1'
    );
    subscription.publish([expense()]);
    mockedCommands.changeCategory.mockResolvedValue(
      commandResult({ categoryId: 'FOOD', memo: 'old memo' })
    );

    await updateExpenseCategory('expense-1', 'food', 3);

    expect(rendered.at(-1)?.[0]).toMatchObject({
      aggregateVersion: 4,
      category: 'food',
      cardType: 'local_currency',
      cardLastFour: 'regional-card(1234)',
      splitGroupId: 'split-group-1',
      splitIndex: 1,
      splitTotal: 3,
    });
  });

  test('지출 나누기는 원본만 먼저 숨기지 않고 서버 snapshot에서 파생 항목으로 교체한다', async () => {
    const rendered: Expense[][] = [];
    const subscription = ledgerOptimisticProjection.subscribe(
      (items) => rendered.push(items),
      () => true,
      'house-1'
    );
    const original = expense({ id: 'item-split-source' });
    const derived = [
      expense({
        id: 'item-split-derived-1',
        aggregateVersion: 1,
        merchant: '첫 항목',
        amount: 4_000,
      }),
      expense({
        id: 'item-split-derived-2',
        aggregateVersion: 1,
        merchant: '둘째 항목',
        amount: 6_000,
      }),
    ];
    subscription.publish([original]);
    mockedCommands.split.mockResolvedValue(derived.map(({ id }) => id));

    await splitExpense(original, [
      { merchant: '첫 항목', amount: 4_000, category: 'etc' },
      { merchant: '둘째 항목', amount: 6_000, category: 'etc' },
    ]);

    expect(rendered.at(-1)).toEqual([original]);
    expect(rendered).not.toContainEqual([]);

    subscription.publish(derived);
    expect(rendered.at(-1)).toHaveLength(2);
    expect(rendered.at(-1)).toEqual(expect.arrayContaining(derived));
    expect(rendered).not.toContainEqual([]);
    subscription.dispose();
  });

  test('기존 지출 월 분할도 원본과 파생 항목 사이에 빈 목록을 만들지 않는다', async () => {
    const rendered: Expense[][] = [];
    const subscription = ledgerOptimisticProjection.subscribe(
      (items) => rendered.push(items),
      () => true,
      'house-1'
    );
    const original = expense({ id: 'monthly-split-source' });
    const firstInstallment = expense({
      id: 'monthly-split-derived-1',
      aggregateVersion: 1,
      merchant: 'regional merchant (1/2)',
      amount: 5_000,
      splitGroupId: 'monthly-group:command-1',
      splitIndex: 1,
      splitTotal: 2,
    });
    subscription.publish([original]);
    mockedCommands.splitExistingMonthly.mockResolvedValue({
      transactionIds: [
        'monthly-split-derived-1',
        'monthly-split-derived-2',
      ],
      splitGroupId: 'monthly-group:command-1',
    });

    await splitExpenseMonthly(original, 2);

    expect(rendered.at(-1)).toEqual([original]);
    expect(rendered).not.toContainEqual([]);

    // 현재 월 구독에는 첫 회차만 들어오며, Firestore transaction snapshot이
    // superseded 원본과 active 파생 항목을 한 번에 교체합니다.
    subscription.publish([firstInstallment]);
    expect(rendered.at(-1)).toEqual([firstInstallment]);
    expect(rendered).not.toContainEqual([]);
    subscription.dispose();
  });

  test('merge는 old target을 갱신하지 않고 두 원본을 새 merged aggregate로 교체한다', async () => {
    const rendered: Expense[][] = [];
    const subscription = ledgerOptimisticProjection.subscribe(
      (items) => rendered.push(items),
      () => true,
      'house-1'
    );
    const target = expense({
      id: 'target',
      amount: 10_000,
      aggregateVersion: 3,
      mergedFrom: undefined,
    });
    const source = expense({
      id: 'source',
      merchant: 'source merchant',
      amount: 4_000,
      aggregateVersion: 5,
      mergedFrom: undefined,
    });
    subscription.publish([target, source]);
    mockedCreateCommandId.mockReturnValue('merge-command-1');
    mockedCommands.merge.mockResolvedValue({
      transactionId: 'merged:merge-command-1',
    });

    const mergedId = await mergeExpenses(target, source);

    expect(mergedId).toBe('merged:merge-command-1');
    expect(rendered.at(-1)).toEqual([
      expect.objectContaining({
        id: 'merged:merge-command-1',
        aggregateVersion: 1,
        amount: 14_000,
        mergeLeafIds: ['target', 'source'],
      }),
    ]);
    expect(rendered.at(-1)?.some(({ id }) => id === 'target')).toBe(false);
    expect(mockedCommands.merge).toHaveBeenCalledWith(
      'house-1',
      'target',
      3,
      'source',
      5,
      'merge-command-1'
    );
    subscription.dispose();
  });

  test('서버 snapshot 전 연속 합치기도 optimistic merged ID를 다음 target으로 사용한다', async () => {
    const rendered: Expense[][] = [];
    const subscription = ledgerOptimisticProjection.subscribe(
      (items) => rendered.push(items),
      () => true,
      'house-1'
    );
    const target = expense({ id: 'target', amount: 10_000, mergedFrom: undefined });
    const source = expense({ id: 'source', amount: 4_000, mergedFrom: undefined });
    const third = expense({
      id: 'third',
      aggregateVersion: 2,
      amount: 6_000,
      mergedFrom: undefined,
    });
    subscription.publish([target, source, third]);
    mockedCreateCommandId
      .mockReturnValueOnce('merge-command-1')
      .mockReturnValueOnce('merge-command-2');
    mockedCommands.merge
      .mockResolvedValueOnce({ transactionId: 'merged:merge-command-1' })
      .mockResolvedValueOnce({ transactionId: 'merged:merge-command-2' });

    await mergeExpenses(target, source);
    expect(rendered.at(-1)?.map(({ id }) => id)).toEqual(
      expect.arrayContaining(['merged:merge-command-1', 'third'])
    );
    expect(rendered.at(-1)?.some(({ id }) => id === 'target')).toBe(false);
    const firstMerged = rendered.at(-1)?.find(
      ({ id }) => id === 'merged:merge-command-1'
    );
    expect(firstMerged).toBeDefined();

    await mergeExpenses(firstMerged!, third);

    expect(mockedCommands.merge).toHaveBeenNthCalledWith(
      2,
      'house-1',
      'merged:merge-command-1',
      1,
      'third',
      2,
      'merge-command-2'
    );
    expect(rendered.at(-1)?.map(({ id }) => id)).toEqual([
      'merged:merge-command-2',
    ]);
    subscription.dispose();
  });

  test('merge command 거부 시 target/source 삭제와 새 merged 생성 overlay를 모두 rollback한다', async () => {
    const rendered: Expense[][] = [];
    const subscription = ledgerOptimisticProjection.subscribe(
      (items) => rendered.push(items),
      () => true,
      'house-1'
    );
    const target = expense({ id: 'target', amount: 10_000, mergedFrom: undefined });
    const source = expense({ id: 'source', amount: 4_000, mergedFrom: undefined });
    subscription.publish([target, source]);
    mockedCreateCommandId.mockReturnValue('merge-command-rejected');
    mockedCommands.merge.mockRejectedValue(new Error('VERSION_MISMATCH'));

    await expect(mergeExpenses(target, source)).rejects.toThrow('VERSION_MISMATCH');

    expect(rendered.at(-1)?.map(({ id }) => id).sort()).toEqual([
      'source',
      'target',
    ]);
    expect(rendered.at(-1)?.some(({ id }) => id.startsWith('merged:'))).toBe(false);
    subscription.dispose();
  });

  test('mergeLeafIds만 있는 서버 병합 거래도 되돌리기 command를 실행한다', async () => {
    const merged = expense({
      id: 'merged:server-command',
      aggregateVersion: 1,
      mergedFrom: undefined,
      mergeLeafIds: ['target', 'source'],
    });
    mockedCommands.unmerge.mockResolvedValue(['target', 'source']);

    await expect(unmergeExpense(merged)).resolves.toEqual(['target', 'source']);
    expect(mockedCommands.unmerge).toHaveBeenCalledWith(
      'house-1',
      'merged:server-command',
      1
    );
  });
});
