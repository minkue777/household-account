interface BudgetCategory {
  readonly key: string;
  readonly budget: number | null;
}

interface CategoryExpense {
  readonly category: string;
  readonly amount: number;
}

/** 활성 카테고리를 입력받습니다. 0원도 설정된 예산이며 null만 미설정입니다. */
export function calculateMonthlyBudgetSummary(
  activeCategories: readonly BudgetCategory[],
  expenses: readonly CategoryExpense[],
) {
  const budgetedCategoryKeys = new Set<string>();
  let totalBudget = 0;
  for (const category of activeCategories) {
    if (category.budget === null) continue;
    budgetedCategoryKeys.add(category.key);
    totalBudget += category.budget;
  }

  let budgetedSpent = 0;
  let monthlySpent = 0;
  for (const expense of expenses) {
    monthlySpent += expense.amount;
    if (budgetedCategoryKeys.has(expense.category)) budgetedSpent += expense.amount;
  }
  const remaining = totalBudget - budgetedSpent;
  return { remaining, isOverBudget: remaining < 0, monthlySpent };
}

/** 잔여 예산 포함 여부와 달리 진행률은 양수 예산에서만 표시합니다. */
export function categoryBudgetProgress(total: number, budget: number | null) {
  const hasBudget = budget !== null && budget > 0;
  return {
    hasBudget,
    percentage: hasBudget ? total / budget * 100 : 0,
    overrun: hasBudget ? Math.max(0, total - budget) : 0,
  };
}
