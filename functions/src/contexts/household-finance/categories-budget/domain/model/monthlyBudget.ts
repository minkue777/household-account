export interface BudgetCategoryFact {
  categoryId: string;
  budgetInWon: number | null;
  active: boolean;
}

export interface LedgerExpenseFact {
  transactionId: string;
  accountingDate: string;
  categoryId: string;
  amountInWon: number;
}

export interface CategoryBudgetStatus {
  categoryId: string;
  budgetInWon: number | null;
  spentInWon: number;
  progress: number | null;
  overrunInWon: number;
}

export interface MonthlyBudgetView {
  month: string;
  totalBudget: number;
  budgetedCategoryExpense: number;
  totalExpense: number;
  remainingBudget: number;
  categories: readonly CategoryBudgetStatus[];
}

export type MonthlyBudgetCalculationResult =
  | { kind: "success"; value: MonthlyBudgetView }
  | { kind: "no-data"; code: "NO_CATEGORIES_OR_TRANSACTIONS" };
