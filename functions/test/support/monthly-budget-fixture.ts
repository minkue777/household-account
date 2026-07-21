import { createMonthlyBudgetQuery } from "../../src/contexts/household-finance/categories-budget/application/queries/getMonthlyBudget";
import type {
  LedgerExpensePageRequest,
  LedgerExpensePageSourceResult,
  MonthlyBudgetPageSourcePort,
} from "../../src/contexts/household-finance/categories-budget/application/ports/out/monthlyBudgetPageSourcePort";
import type {
  BudgetCategoryFact,
  LedgerExpenseFact,
} from "../../src/contexts/household-finance/categories-budget/domain/model/monthlyBudget";
import type { MonthlyBudgetQuery } from "../../src/contexts/household-finance/categories-budget/public";

export interface MonthlyBudgetFixture {
  categories: readonly BudgetCategoryFact[];
  ledgerPages: readonly (readonly LedgerExpenseFact[])[];
  failAtPage?: number;
  sourceWindowChangesAtPage?: number;
}

class FixtureMonthlyBudgetPageSource implements MonthlyBudgetPageSourcePort {
  constructor(private readonly fixture: MonthlyBudgetFixture) {}

  async readBudgetCategories() {
    return {
      kind: "success" as const,
      categories: this.fixture.categories,
    };
  }

  async readLedgerExpensePage(
    request: LedgerExpensePageRequest,
  ): Promise<LedgerExpensePageSourceResult> {
    const pageIndex = this.pageIndex(request.cursor);

    if (pageIndex === null || pageIndex >= this.fixture.ledgerPages.length) {
      return { kind: "contract-failure", code: "LEDGER_CURSOR_INVALID" };
    }
    if (this.fixture.failAtPage === pageIndex) {
      return { kind: "retryable-failure", code: "LEDGER_PAGE_UNAVAILABLE" };
    }

    const sourceWindow =
      this.fixture.sourceWindowChangesAtPage !== undefined &&
      pageIndex >= this.fixture.sourceWindowChangesAtPage
        ? "fixture-window-2"
        : "fixture-window-1";
    const nextPageIndex = pageIndex + 1;

    return {
      kind: "success",
      page: {
        expenses: this.fixture.ledgerPages[pageIndex],
        sourceWindow,
        nextCursor:
          nextPageIndex < this.fixture.ledgerPages.length
            ? `fixture-page-${nextPageIndex}`
            : null,
      },
    };
  }

  private pageIndex(cursor: string | null): number | null {
    if (cursor === null) {
      return 0;
    }

    const match = /^fixture-page-(\d+)$/.exec(cursor);
    return match === null ? null : Number(match[1]);
  }
}

export function createMonthlyBudgetFixtureSubject(
  fixture: MonthlyBudgetFixture,
): MonthlyBudgetQuery {
  return createMonthlyBudgetQuery(new FixtureMonthlyBudgetPageSource(fixture));
}
