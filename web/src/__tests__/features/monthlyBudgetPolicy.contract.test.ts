import { calculateMonthlyBudgetSummary, categoryBudgetProgress } from '@/features/category-budget/monthlyBudget';

describe('[BUD-001][BUD-002] 실제 홈 예산 계산', () => {
  it('0원 예산은 잔여 예산에 포함하고 미설정/보관 카테고리의 지출은 월 지출에만 포함한다', () => {
    const result = calculateMonthlyBudgetSummary([
      { key: 'zero', budget: 0 }, { key: 'food', budget: 10_000 }, { key: 'unset', budget: null },
    ], [
      { category: 'zero', amount: 1_000 }, { category: 'food', amount: 3_000 },
      { category: 'unset', amount: 2_000 }, { category: 'archived', amount: 4_000 },
    ]);
    expect(result).toEqual({ remaining: 6_000, isOverBudget: false, monthlySpent: 10_000 });
    expect(calculateMonthlyBudgetSummary([{ key: 'zero', budget: 0 }], [{ category: 'zero', amount: 1_000 }]))
      .toEqual({ remaining: -1_000, isOverBudget: true, monthlySpent: 1_000 });
  });

  it('미설정/0원에는 진행률을 만들지 않고 양수 예산의 비율과 초과액을 보존한다', () => {
    expect(categoryBudgetProgress(1_000, null)).toEqual({ hasBudget: false, percentage: 0, overrun: 0 });
    expect(categoryBudgetProgress(1_000, 0)).toEqual({ hasBudget: false, percentage: 0, overrun: 0 });
    expect(categoryBudgetProgress(15_000, 10_000)).toEqual({ hasBudget: true, percentage: 150, overrun: 5_000 });
  });
});
