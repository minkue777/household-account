import { waitFor } from '@testing-library/react';

const listTransactions = jest.fn();
const onSnapshot = jest.fn();

jest.mock('@/features/ledger/application/ledgerCommands', () => ({
  ledgerCommands: {},
}));
jest.mock('@/features/ledger/application/ledgerQueries', () => ({
  ledgerQueries: { listTransactions: (...args: unknown[]) => listTransactions(...args) },
}));
jest.mock('@/features/ledger/application/ledgerReadVisibility', () => ({
  isVisibleLedgerReadDocument: () => true,
}));
jest.mock('@/composition/clientSessionScope', () => ({
  requireClientSessionScope: () => ({ householdId: 'household-1' }),
}));
jest.mock('@/platform/android-host/androidHostBridge', () => ({
  isAndroidHostAvailable: () => true,
}));
jest.mock('@/platform/network/operationDeadline', () => ({
  withinDeadline: (operation: Promise<unknown>) => operation,
}));
jest.mock('@/platform/read-model/firestoreReadModel', () => ({
  collection: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  onSnapshot: (...args: unknown[]) => onSnapshot(...args),
  getDocs: jest.fn(),
  db: {},
}));

import { subscribeToMonthlyExpenses } from '@/lib/expenseService';

describe('Android ledger read contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('Android WebView에서는 Firestore stream 대신 인증된 월 범위 Query를 사용한다', async () => {
    listTransactions.mockResolvedValue({
      transactions: [{
        id: 'transaction-1',
        aggregateVersion: 3,
        date: '2026-07-22',
        merchant: '가맹점',
        amount: 12_000,
        transactionType: 'expense',
        category: 'etc',
        cardDisplay: '삼성(1876)',
      }],
    });
    const callback = jest.fn();

    const unsubscribe = subscribeToMonthlyExpenses(2026, 7, callback, {
      transactionType: 'expense',
    });

    await waitFor(() => expect(callback).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'transaction-1',
        cardLastFour: '삼성(1876)',
      }),
    ]));
    expect(listTransactions).toHaveBeenCalledWith(
      '2026-07-01',
      '2026-07-31',
      'expense'
    );
    expect(onSnapshot).not.toHaveBeenCalled();

    unsubscribe();
  });
});
