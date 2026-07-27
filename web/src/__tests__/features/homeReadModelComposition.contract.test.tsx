import { act, render, screen, waitFor } from '@testing-library/react';
import {
  LedgerReadModelProvider,
  useLedgerReadModel,
} from '@/contexts/LedgerReadModelContext';

const subscribeToMonthlyExpenses = jest.fn();
const subscribeToLocalCurrencyBalance = jest.fn();

jest.mock('next/navigation', () => ({
  usePathname: () => '/',
}));

jest.mock('@/contexts/HouseholdContext', () => ({
  useHousehold: () => ({
    householdKey: 'household-1',
    isSessionVerified: true,
    remoteReadEpoch: 0,
  }),
}));

jest.mock('@/lib/expenseService', () => ({
  subscribeToMonthlyExpenses: (...args: unknown[]) =>
    subscribeToMonthlyExpenses(...args),
}));

jest.mock('@/lib/balanceService', () => ({
  subscribeToLocalCurrencyBalance: (...args: unknown[]) =>
    subscribeToLocalCurrencyBalance(...args),
}));

function ReadModelConsumer({ testId }: { testId: string }) {
  const model = useLedgerReadModel({
    year: 2026,
    month: 7,
    transactionType: 'expense',
  });
  return (
    <output
      data-testid={testId}
      data-loading={String(model.isLoading)}
      data-count={String(model.expenses.length)}
      data-balance={String(model.localCurrencyBalance?.balance ?? '')}
      data-error={String(model.readError != null)}
      data-refresh-key={model.readRefreshKey}
    />
  );
}

describe('홈 read model 합성 계약', () => {
  beforeEach(() => {
    subscribeToMonthlyExpenses.mockReset();
    subscribeToLocalCurrencyBalance.mockReset();
    subscribeToMonthlyExpenses.mockImplementation(
      (
        _year: number,
        _month: number,
        callback: (items: unknown[]) => void
      ) => {
        callback([{
          id: 'expense-1',
          date: '2026-07-26',
          merchant: '가맹점',
          amount: 1_000,
          category: 'etc',
          transactionType: 'expense',
          aggregateVersion: 1,
        }]);
        return jest.fn();
      }
    );
    subscribeToLocalCurrencyBalance.mockImplementation(
      (
        callback: (balance: {
          balance: number;
          currencyType: string;
          updatedAt: Date;
        }) => void
      ) => {
        callback({
          balance: 20_000,
          currencyType: 'gyeonggi',
          updatedAt: new Date('2026-07-26T00:00:00.000Z'),
        });
        return jest.fn();
      }
    );
  });

  it('같은 홈 화면의 소비자가 여럿이어도 월 원장과 지역화폐 구독은 각각 하나만 연다', async () => {
    render(
      <LedgerReadModelProvider>
        <ReadModelConsumer testId="mobile-view" />
        <ReadModelConsumer testId="desktop-view" />
      </LedgerReadModelProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('mobile-view')).toHaveAttribute('data-count', '1');
      expect(screen.getByTestId('desktop-view')).toHaveAttribute('data-count', '1');
    });

    expect(subscribeToMonthlyExpenses).toHaveBeenCalledTimes(1);
    expect(subscribeToLocalCurrencyBalance).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('mobile-view')).toHaveAttribute('data-loading', 'false');
    expect(screen.getByTestId('mobile-view')).toHaveAttribute('data-balance', '20000');
  });

  it('원격 읽기 재연결 중에도 기존 원장을 유지하고 새 서버 응답에서 교체한다', async () => {
    const callbacks: Array<(items: unknown[]) => void> = [];
    const unsubscribes: jest.Mock[] = [];
    subscribeToMonthlyExpenses.mockImplementation(
      (
        _year: number,
        _month: number,
        callback: (items: unknown[]) => void
      ) => {
        callbacks.push(callback);
        const unsubscribe = jest.fn();
        unsubscribes.push(unsubscribe);
        if (callbacks.length === 1) {
          callback([{
            id: 'expense-1',
            date: '2026-07-27',
            merchant: '기존 가맹점',
            amount: 1_000,
            category: 'etc',
            transactionType: 'expense',
            aggregateVersion: 1,
          }]);
        }
        return unsubscribe;
      }
    );

    const view = (
      <LedgerReadModelProvider>
        <ReadModelConsumer testId="ledger-view" />
      </LedgerReadModelProvider>
    );
    render(view);

    await waitFor(() => {
      expect(screen.getByTestId('ledger-view')).toHaveAttribute('data-count', '1');
      expect(screen.getByTestId('ledger-view')).toHaveAttribute('data-loading', 'false');
    });

    act(() => {
      window.dispatchEvent(new Event('household-account:android-resume'));
    });

    await waitFor(() => {
      expect(subscribeToMonthlyExpenses).toHaveBeenCalledTimes(2);
      expect(subscribeToLocalCurrencyBalance).toHaveBeenCalledTimes(2);
      expect(unsubscribes[0]).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('ledger-view')).toHaveAttribute('data-count', '1');
    expect(screen.getByTestId('ledger-view')).toHaveAttribute('data-loading', 'false');
    expect(screen.getByTestId('ledger-view')).toHaveAttribute('data-balance', '20000');
    expect(screen.getByTestId('ledger-view')).toHaveAttribute('data-refresh-key', '0:1');

    act(() => {
      callbacks[1]([
        {
          id: 'expense-1',
          date: '2026-07-27',
          merchant: '기존 가맹점',
          amount: 1_000,
          category: 'etc',
          transactionType: 'expense',
          aggregateVersion: 1,
        },
        {
          id: 'expense-2',
          date: '2026-07-27',
          merchant: '메가MGC커피',
          amount: 2_600,
          category: 'etc',
          transactionType: 'expense',
          aggregateVersion: 1,
        },
      ]);
    });

    await waitFor(() => {
      expect(screen.getByTestId('ledger-view')).toHaveAttribute('data-count', '2');
      expect(screen.getByTestId('ledger-view')).toHaveAttribute('data-loading', 'false');
    });
  });

  it('같은 범위 재구독 실패 시 기존 원장을 유지하면서 저하 상태를 노출한다', async () => {
    const callbacks: Array<(items: unknown[]) => void> = [];
    const errors: Array<(error: unknown) => void> = [];
    subscribeToMonthlyExpenses.mockImplementation(
      (
        _year: number,
        _month: number,
        callback: (items: unknown[]) => void,
        options: { onError?: (error: unknown) => void }
      ) => {
        callbacks.push(callback);
        errors.push(options.onError ?? (() => undefined));
        if (callbacks.length === 1) {
          callback([{
            id: 'expense-1',
            date: '2026-07-27',
            merchant: '기존 가맹점',
            amount: 1_000,
            category: 'etc',
            transactionType: 'expense',
            aggregateVersion: 1,
          }]);
        }
        return jest.fn();
      }
    );

    render(
      <LedgerReadModelProvider>
        <ReadModelConsumer testId="ledger-view" />
      </LedgerReadModelProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('ledger-view')).toHaveAttribute('data-count', '1');
      expect(screen.getByTestId('ledger-view')).toHaveAttribute('data-loading', 'false');
    });

    act(() => {
      window.dispatchEvent(new Event('household-account:android-resume'));
    });
    await waitFor(() => {
      expect(errors).toHaveLength(2);
    });

    act(() => {
      errors[1](new Error('reconnect failed'));
    });

    expect(screen.getByTestId('ledger-view')).toHaveAttribute('data-count', '1');
    expect(screen.getByTestId('ledger-view')).toHaveAttribute('data-loading', 'false');
    expect(screen.getByTestId('ledger-view')).toHaveAttribute('data-error', 'true');

    act(() => {
      callbacks[1]([
        {
          id: 'expense-1',
          date: '2026-07-27',
          merchant: '기존 가맹점',
          amount: 1_000,
          category: 'etc',
          transactionType: 'expense',
          aggregateVersion: 1,
        },
        {
          id: 'expense-2',
          date: '2026-07-27',
          merchant: '메가MGC커피',
          amount: 2_600,
          category: 'etc',
          transactionType: 'expense',
          aggregateVersion: 1,
        },
      ]);
    });

    await waitFor(() => {
      expect(screen.getByTestId('ledger-view')).toHaveAttribute('data-count', '2');
      expect(screen.getByTestId('ledger-view')).toHaveAttribute('data-error', 'false');
    });
  });
});
