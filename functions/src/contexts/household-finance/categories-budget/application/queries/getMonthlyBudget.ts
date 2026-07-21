import { calculateMonthlyBudget } from "../../domain/calculations/monthlyBudgetCalculator";
import {
  LedgerExpenseFact,
  MonthlyBudgetView,
} from "../../domain/model/monthlyBudget";
import { MonthlyBudgetPageSourcePort } from "../ports/out/monthlyBudgetPageSourcePort";

export type MonthlyBudgetQueryResult =
  | { kind: "success"; value: MonthlyBudgetView }
  | { kind: "no-data"; code: "NO_CATEGORIES_OR_TRANSACTIONS" }
  | { kind: "retryable-failure"; code: string }
  | { kind: "contract-failure"; code: string };

export interface MonthlyBudgetQuery {
  getMonthlyBudget(month: string): Promise<MonthlyBudgetQueryResult>;
}

const MAX_LEDGER_PAGE_COUNT = 1_000;

function isValidMonth(month: string): boolean {
  return /^\d{4}-(?:0[1-9]|1[0-2])$/.test(month);
}

class DefaultMonthlyBudgetQuery implements MonthlyBudgetQuery {
  constructor(private readonly source: MonthlyBudgetPageSourcePort) {}

  async getMonthlyBudget(month: string): Promise<MonthlyBudgetQueryResult> {
    if (!isValidMonth(month)) {
      return { kind: "contract-failure", code: "INVALID_MONTH" };
    }

    const categoryResult = await this.source.readBudgetCategories();
    if (categoryResult.kind !== "success") {
      return categoryResult;
    }

    const expenses: LedgerExpenseFact[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    let sourceWindow: string | undefined;

    for (let pageCount = 0; pageCount < MAX_LEDGER_PAGE_COUNT; pageCount += 1) {
      const pageResult = await this.source.readLedgerExpensePage({ month, cursor });
      if (pageResult.kind !== "success") {
        return pageResult;
      }

      const page = pageResult.page;
      if (page.sourceWindow.length === 0) {
        return { kind: "contract-failure", code: "LEDGER_SOURCE_WINDOW_REQUIRED" };
      }
      if (sourceWindow === undefined) {
        sourceWindow = page.sourceWindow;
      } else if (sourceWindow !== page.sourceWindow) {
        return {
          kind: "contract-failure",
          code: "LEDGER_SOURCE_WINDOW_CHANGED",
        };
      }

      expenses.push(...page.expenses);

      if (page.nextCursor === null) {
        return calculateMonthlyBudget({
          month,
          categories: categoryResult.categories,
          expenses,
        });
      }

      if (page.nextCursor.length === 0 || seenCursors.has(page.nextCursor)) {
        return { kind: "contract-failure", code: "LEDGER_CURSOR_INVALID" };
      }

      seenCursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }

    return { kind: "contract-failure", code: "LEDGER_PAGE_LIMIT_EXCEEDED" };
  }
}

export function createMonthlyBudgetQuery(
  source: MonthlyBudgetPageSourcePort,
): MonthlyBudgetQuery {
  return new DefaultMonthlyBudgetQuery(source);
}
