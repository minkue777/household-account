import { act, render, screen, waitFor } from '@testing-library/react';
import {
  LedgerReadModelProvider,
  useLedgerReadModel,
} from '@/contexts/LedgerReadModelContext';

const subscribeToMonthlyTransactions = jest.fn();
const subscribeToLocalCurrencyBalance = jest.fn();
let mockPathname = '/';

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

jest.mock('@/contexts/HouseholdContext', () => ({
  useHousehold: () => ({
    householdKey: 'household-1',
    isSessionVerified: true,
    remoteReadEpoch: 0,
  }),
}));

jest.mock('@/lib/expenseService', () => ({
  subscribeToMonthlyTransactions: (...args: unknown[]) =>
    subscribeToMonthlyTransactions(...args),
}));

jest.mock('@/lib/balanceService', () => ({
  subscribeToLocalCurrencyBalance: (...args: unknown[]) =>
    subscribeToLocalCurrencyBalance(...args),
}));

function ReadModelConsumer({
  testId,
  month = 7,
  transactionType = 'expense',
}: {
  testId: string;
  month?: number;
  transactionType?: 'expense' | 'income';
}) {
  const model = useLedgerReadModel({
    year: 2026,
    month,
    transactionType,
  });
  return (
    <output
      data-testid={testId}
      data-loading={String(model.isLoading)}
      data-ready={String(model.serverSnapshotReady)}
      data-count={String(model.expenses.length)}
      data-ids={model.expenses.map(({ id }) => id).join(',')}
      data-balance={String(model.localCurrencyBalance?.balance ?? '')}
      data-error={String(model.readError != null)}
      data-refresh-key={model.readRefreshKey}
    />
  );
}

describe('홈 read model 합성 계약', () => {
  beforeEach(() => {
    mockPathname = '/';
    subscribeToMonthlyTransactions.mockReset();
    subscribeToLocalCurrencyBalance.mockReset();
    subscribeToMonthlyTransactions.mockImplementation(
      (
        _year: number,
        _month: number,
        callback: (items: unknown[]) => void
      ) => {
        callback([
          {
            id: 'expense-1',
            date: '2026-07-26',
            merchant: '가맹점',
            amount: 1_000,
            category: 'etc',
            transactionType: 'expense',
            aggregateVersion: 1,
          },
          {
            id: 'income-1',
            date: '2026-07-25',
            merchant: '급여',
            amount: 3_000_000,
            category: 'income',
            transactionType: 'income',
            aggregateVersion: 1,
          },
        ]);
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

    expect(subscribeToMonthlyTransactions).toHaveBeenCalledTimes(1);
    expect(subscribeToLocalCurrencyBalance).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('mobile-view')).toHaveAttribute('data-loading', 'false');
    expect(screen.getByTestId('mobile-view')).toHaveAttribute('data-balance', '20000');
  });

  it('내부 경로에서 소비자가 사라져도 월 원장과 지역화폐 구독을 유지하고 최신 값을 계속 받는다', async () => {
    const transactionCallbacks: Array<(items: unknown[]) => void> = [];
    const balanceCallbacks: Array<(balance: {
      balance: number;
      currencyType: string;
      updatedAt: Date;
    }) => void> = [];
    const unsubscribeTransactions = jest.fn();
    const unsubscribeBalance = jest.fn();

    subscribeToMonthlyTransactions.mockImplementation(
      (
        _year: number,
        _month: number,
        callback: (items: unknown[]) => void
      ) => {
        transactionCallbacks.push(callback);
        callback([{
          id: 'before-route-change',
          date: '2026-07-26',
          merchant: '이동 전 거래',
          amount: 1_000,
          category: 'etc',
          transactionType: 'expense',
          aggregateVersion: 1,
        }]);
        return unsubscribeTransactions;
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
        balanceCallbacks.push(callback);
        callback({
          balance: 20_000,
          currencyType: 'gyeonggi',
          updatedAt: new Date('2026-07-26T00:00:00.000Z'),
        });
        return unsubscribeBalance;
      }
    );

    const view = render(
      <LedgerReadModelProvider>
        <ReadModelConsumer testId="ledger-view" />
      </LedgerReadModelProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('ledger-view')).toHaveAttribute(
        'data-ids',
        'before-route-change'
      );
      expect(screen.getByTestId('ledger-view')).toHaveAttribute(
        'data-balance',
        '20000'
      );
    });

    mockPathname = '/settings';
    view.rerender(
      <LedgerReadModelProvider>
        <div data-testid="settings-view" />
      </LedgerReadModelProvider>
    );

    expect(screen.queryByTestId('ledger-view')).not.toBeInTheDocument();
    expect(subscribeToMonthlyTransactions).toHaveBeenCalledTimes(1);
    expect(subscribeToLocalCurrencyBalance).toHaveBeenCalledTimes(1);
    expect(unsubscribeTransactions).not.toHaveBeenCalled();
    expect(unsubscribeBalance).not.toHaveBeenCalled();

    act(() => {
      transactionCallbacks[0]([{
        id: 'while-consumer-unmounted',
        date: '2026-07-27',
        merchant: '화면 밖에서 갱신된 거래',
        amount: 2_000,
        category: 'etc',
        transactionType: 'expense',
        aggregateVersion: 2,
      }]);
      balanceCallbacks[0]({
        balance: 18_000,
        currencyType: 'gyeonggi',
        updatedAt: new Date('2026-07-27T00:00:00.000Z'),
      });
    });

    mockPathname = '/';
    view.rerender(
      <LedgerReadModelProvider>
        <ReadModelConsumer testId="ledger-view" />
      </LedgerReadModelProvider>
    );

    expect(screen.getByTestId('ledger-view')).toHaveAttribute(
      'data-ids',
      'while-consumer-unmounted'
    );
    expect(screen.getByTestId('ledger-view')).toHaveAttribute(
      'data-balance',
      '18000'
    );
    expect(subscribeToMonthlyTransactions).toHaveBeenCalledTimes(1);
    expect(subscribeToLocalCurrencyBalance).toHaveBeenCalledTimes(1);
    expect(unsubscribeTransactions).not.toHaveBeenCalled();
    expect(unsubscribeBalance).not.toHaveBeenCalled();
  });

  it('같은 월의 지출과 수입 전환은 원본 구독을 다시 열지 않고 메모리에서 즉시 파생한다', async () => {
    const unsubscribe = jest.fn();
    subscribeToMonthlyTransactions.mockImplementation(
      (
        _year: number,
        _month: number,
        callback: (items: unknown[]) => void
      ) => {
        callback([
          {
            id: 'expense-1',
            date: '2026-07-26',
            merchant: '가맹점',
            amount: 1_000,
            category: 'etc',
            transactionType: 'expense',
            aggregateVersion: 1,
          },
          {
            id: 'income-1',
            date: '2026-07-25',
            merchant: '급여',
            amount: 3_000_000,
            category: 'income',
            transactionType: 'income',
            aggregateVersion: 1,
          },
        ]);
        return unsubscribe;
      }
    );

    const view = render(
      <LedgerReadModelProvider>
        <ReadModelConsumer testId="ledger-view" />
      </LedgerReadModelProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('ledger-view')).toHaveAttribute('data-ids', 'expense-1');
      expect(screen.getByTestId('ledger-view')).toHaveAttribute('data-ready', 'true');
    });

    mockPathname = '/income';
    view.rerender(
      <LedgerReadModelProvider>
        <ReadModelConsumer testId="ledger-view" transactionType="income" />
      </LedgerReadModelProvider>
    );

    expect(screen.getByTestId('ledger-view')).toHaveAttribute('data-ids', 'income-1');
    expect(screen.getByTestId('ledger-view')).toHaveAttribute('data-loading', 'false');
    expect(screen.getByTestId('ledger-view')).toHaveAttribute('data-ready', 'true');
    expect(subscribeToMonthlyTransactions).toHaveBeenCalledTimes(1);
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it('월이 바뀌면 기존 월 구독을 종료하고 새 월 서버 응답을 기다린다', async () => {
    const callbacks: Array<(items: unknown[]) => void> = [];
    const unsubscribes: jest.Mock[] = [];
    subscribeToMonthlyTransactions.mockImplementation(
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
            id: 'july-expense',
            date: '2026-07-26',
            merchant: '7월 거래',
            amount: 1_000,
            category: 'etc',
            transactionType: 'expense',
            aggregateVersion: 1,
          }]);
        }
        return unsubscribe;
      }
    );

    const view = render(
      <LedgerReadModelProvider>
        <ReadModelConsumer testId="ledger-view" />
      </LedgerReadModelProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('ledger-view')).toHaveAttribute('data-ids', 'july-expense');
    });

    view.rerender(
      <LedgerReadModelProvider>
        <ReadModelConsumer testId="ledger-view" month={8} />
      </LedgerReadModelProvider>
    );

    await waitFor(() => {
      expect(subscribeToMonthlyTransactions).toHaveBeenCalledTimes(2);
      expect(unsubscribes[0]).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('ledger-view')).toHaveAttribute('data-loading', 'true');
      expect(screen.getByTestId('ledger-view')).toHaveAttribute('data-count', '0');
    });

    act(() => {
      callbacks[1]([{
        id: 'august-expense',
        date: '2026-08-01',
        merchant: '8월 거래',
        amount: 2_000,
        category: 'etc',
        transactionType: 'expense',
        aggregateVersion: 1,
      }]);
    });

    await waitFor(() => {
      expect(screen.getByTestId('ledger-view')).toHaveAttribute('data-ids', 'august-expense');
      expect(screen.getByTestId('ledger-view')).toHaveAttribute('data-loading', 'false');
    });
  });

  it('원격 읽기 재연결 중에도 기존 원장을 유지하고 새 서버 응답에서 교체한다', async () => {
    const callbacks: Array<(items: unknown[]) => void> = [];
    const unsubscribes: jest.Mock[] = [];
    subscribeToMonthlyTransactions.mockImplementation(
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
      expect(subscribeToMonthlyTransactions).toHaveBeenCalledTimes(2);
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
    subscribeToMonthlyTransactions.mockImplementation(
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
