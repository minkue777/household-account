import {
  BudgetCategoryFact,
  CategoryBudgetStatus,
  LedgerExpenseFact,
  MonthlyBudgetCalculationResult,
} from "../model/monthlyBudget";

export interface MonthlyBudgetCalculationInput {
  month: string;
  categories: readonly BudgetCategoryFact[];
  expenses: readonly LedgerExpenseFact[];
}

export function calculateMonthlyBudget(
  input: MonthlyBudgetCalculationInput,
): MonthlyBudgetCalculationResult {
  if (input.categories.length === 0 && input.expenses.length === 0) {
    return { kind: "no-data", code: "NO_CATEGORIES_OR_TRANSACTIONS" };
  }

  const spendingByCategory = new Map<string, number>();
  let totalExpense = 0;

  for (const expense of input.expenses) {
    totalExpense += expense.amountInWon;
    spendingByCategory.set(
      expense.categoryId,
      (spendingByCategory.get(expense.categoryId) ?? 0) + expense.amountInWon,
    );
  }

  let totalBudget = 0;
  let budgetedCategoryExpense = 0;
  const categories: CategoryBudgetStatus[] = [];

  for (const category of input.categories) {
    if (!category.active) {
      continue;
    }

    const spentInWon = spendingByCategory.get(category.categoryId) ?? 0;
    const hasEffectiveBudget =
      category.budgetInWon !== null && category.budgetInWon > 0;

    if (hasEffectiveBudget) {
      totalBudget += category.budgetInWon as number;
      budgetedCategoryExpense += spentInWon;
    }

    categories.push({
      categoryId: category.categoryId,
      budgetInWon: category.budgetInWon,
      spentInWon,
      progress: hasEffectiveBudget
        ? spentInWon / (category.budgetInWon as number)
        : null,
      overrunInWon: hasEffectiveBudget
        ? Math.max(spentInWon - (category.budgetInWon as number), 0)
        : 0,
    });
  }

  return {
    kind: "success",
    value: {
      month: input.month,
      totalBudget,
      budgetedCategoryExpense,
      totalExpense,
      remainingBudget: totalBudget - budgetedCategoryExpense,
      categories,
    },
  };
}
