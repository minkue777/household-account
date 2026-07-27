import { render, screen, within } from '@testing-library/react';
import BalanceCards from '@/components/BalanceCards';
import { useCategoryContext } from '@/contexts/CategoryContext';
import type { Expense } from '@/types/expense';

jest.mock('@/contexts/CategoryContext', () => ({
  useCategoryContext: jest.fn(),
}));

const mockUseCategoryContext = jest.mocked(useCategoryContext);

const expense: Expense = {
  id: 'expense-1',
  aggregateVersion: 1,
  amount: 100,
  merchant: '상점',
  category: 'food',
  date: '2026-07-28',
  transactionType: 'expense',
};

function card(label: string) {
  const element = screen.getByText(label).closest('.balance-card-glass');
  if (element === null) throw new Error(`${label} 카드를 찾을 수 없습니다.`);
  return within(element);
}

describe('첫 가계부 요약의 독립 점진 렌더링 계약', () => {
  beforeEach(() => {
    mockUseCategoryContext.mockReturnValue({
      activeCategories: [
        {
          id: 'category-food',
          householdId: 'house-1',
          key: 'food',
          label: '식비',
          color: '#000000',
          budget: 200,
          isActive: true,
          isDefault: false,
          order: 1,
        },
      ],
    } as ReturnType<typeof useCategoryContext>);
  });

  test('월 원장과 카테고리는 각각 도착한 뒤 자신이 필요한 카드만 확정한다', () => {
    const props = {
      currentYear: 2026,
      currentMonth: 7,
      expenses: [expense],
      yearlySpent: null,
      summaryConfig: {
        leftCard: 'monthlyRemainingBudget' as const,
        rightCard: 'monthlySpent' as const,
      },
      transactionType: 'expense' as const,
      localCurrencyBalance: null,
    };
    const { rerender } = render(
      <BalanceCards {...props} ledgerReady={false} categoriesReady={false} />
    );

    expect(card('7월 잔여 예산').getByText('-')).toBeInTheDocument();
    expect(card('7월 지출').getByText('-')).toBeInTheDocument();

    rerender(
      <BalanceCards {...props} ledgerReady={true} categoriesReady={false} />
    );
    expect(card('7월 잔여 예산').getByText('-')).toBeInTheDocument();
    expect(card('7월 지출').getByText('100')).toBeInTheDocument();

    rerender(
      <BalanceCards {...props} ledgerReady={true} categoriesReady={true} />
    );
    expect(card('7월 잔여 예산').getByText('100')).toBeInTheDocument();
  });

  test('지역화폐가 먼저 도착하면 원장 대기와 무관하게 즉시 표시한다', () => {
    render(
      <BalanceCards
        currentYear={2026}
        currentMonth={7}
        expenses={[]}
        yearlySpent={null}
        summaryConfig={{
          leftCard: 'localCurrencyBalance',
          rightCard: 'monthlySpent',
        }}
        transactionType="expense"
        localCurrencyBalance={{
          currencyType: 'gyeonggi',
          balance: 12_345,
          updatedAt: new Date('2026-07-28T00:00:00.000Z'),
        }}
        ledgerReady={false}
        categoriesReady={false}
      />
    );

    expect(card('지역화폐 잔액').getByText('12,345')).toBeInTheDocument();
    expect(card('7월 지출').getByText('-')).toBeInTheDocument();
  });
});
