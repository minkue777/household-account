const execute = jest.fn();

jest.mock('@/composition/webCommandRuntime', () => ({
  getHouseholdCommandClient: () => ({ execute }),
}));

import { ledgerCommands } from '@/features/ledger/application/ledgerCommands';

describe('Ledger Web command DTO', () => {
  beforeEach(() => execute.mockReset());

  test('update는 UI/서버 관리 필드를 버리고 허용된 canonical patch만 보낸다', async () => {
    execute.mockResolvedValue({});

    await ledgerCommands.update('household-1', 'expense-1', 7, {
      id: 'must-not-leak',
      aggregateVersion: 999,
      merchant: '새 가맹점',
      amount: 12000,
      category: 'food',
      date: '2026-07-21',
      memo: '',
      cardType: 'main',
      cardLastFour: '1234',
      splitGroupId: 'server-field',
    });

    expect(execute).toHaveBeenCalledWith(
      'ledger.update-transaction.v1',
      {
        transactionId: 'expense-1',
        expectedVersion: 7,
        patch: {
          merchant: '새 가맹점',
          amountInWon: 12000,
          categoryId: 'food',
          accountingDate: '2026-07-21',
          memo: '',
        },
      },
      { householdId: 'household-1' }
    );
  });

  test('분할 item은 amountInWon/categoryId wire 이름만 사용한다', async () => {
    execute.mockResolvedValue({ transactionIds: ['split-1', 'split-2'] });

    await ledgerCommands.split('household-1', 'expense-1', 3, [
      { merchant: '항목 A', amount: 4000, category: 'food' },
      { merchant: '항목 B', amount: 6000, category: 'living', memo: '메모' },
    ]);

    expect(execute).toHaveBeenCalledWith(
      'ledger.split-transaction.v1',
      {
        transactionId: 'expense-1',
        expectedVersion: 3,
        items: [
          { merchant: '항목 A', amountInWon: 4000, categoryId: 'food' },
          { merchant: '항목 B', amountInWon: 6000, categoryId: 'living', memo: '메모' },
        ],
      },
      { householdId: 'household-1' }
    );
  });

  test('월 분할 취소·재구성은 전체 항목의 expectedVersions를 전달한다', async () => {
    execute.mockResolvedValueOnce({}).mockResolvedValueOnce({ splitGroupId: 'group-2' });
    const versions = { 'expense-1': 2, 'expense-2': 5 };

    await ledgerCommands.cancelMonthlySplit('household-1', 'group-1', versions);
    await ledgerCommands.reconfigureMonthlySplit('household-1', 'group-1', 4, versions);

    expect(execute).toHaveBeenNthCalledWith(
      1,
      'ledger.cancel-monthly-split.v1',
      { splitGroupId: 'group-1', expectedVersions: versions },
      { householdId: 'household-1' }
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      'ledger.reconfigure-monthly-split.v1',
      { splitGroupId: 'group-1', months: 4, expectedVersions: versions },
      { householdId: 'household-1' }
    );
  });
});
