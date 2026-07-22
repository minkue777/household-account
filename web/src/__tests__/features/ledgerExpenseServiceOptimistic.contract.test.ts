import { ledgerCommands } from '@/features/ledger/application/ledgerCommands';
import { ledgerOptimisticProjection } from '@/features/ledger/application/ledgerOptimisticProjection';
import { updateExpense, updateExpenseCategory } from '@/lib/expenseService';
import type { LedgerTransactionCommandResult } from '@/platform/functions-api/householdCommandContract';
import type { Expense } from '@/types/expense';

jest.mock('@/composition/clientSessionScope', () => ({
  requireClientSessionScope: () => ({ householdId: 'house-1', memberId: 'member-1' }),
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
});
