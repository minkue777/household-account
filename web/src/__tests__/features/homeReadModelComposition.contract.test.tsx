import { render, screen, waitFor } from '@testing-library/react';
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
});
