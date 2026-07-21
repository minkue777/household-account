import {
  BudgetCategoryFact,
  LedgerExpenseFact,
} from "../../../domain/model/monthlyBudget";

export type BudgetCategorySourceResult =
  | { kind: "success"; categories: readonly BudgetCategoryFact[] }
  | { kind: "retryable-failure"; code: string }
  | { kind: "contract-failure"; code: string };

export interface LedgerExpensePage {
  expenses: readonly LedgerExpenseFact[];
  sourceWindow: string;
  nextCursor: string | null;
}

export type LedgerExpensePageSourceResult =
  | { kind: "success"; page: LedgerExpensePage }
  | { kind: "retryable-failure"; code: string }
  | { kind: "contract-failure"; code: string };

export interface LedgerExpensePageRequest {
  month: string;
  cursor: string | null;
}

export interface MonthlyBudgetPageSourcePort {
  readBudgetCategories(): Promise<BudgetCategorySourceResult>;
  readLedgerExpensePage(
    request: LedgerExpensePageRequest,
  ): Promise<LedgerExpensePageSourceResult>;
}
