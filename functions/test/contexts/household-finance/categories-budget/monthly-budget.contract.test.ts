import { describe, expect, it } from "vitest";
import type { MonthlyBudgetQuery } from "../../../../src/contexts/household-finance/categories-budget/public";
import {
  createMonthlyBudgetFixtureSubject,
  type MonthlyBudgetFixture,
} from "../../../support/monthly-budget-fixture";

export interface MonthlyBudgetSubject extends MonthlyBudgetQuery {}

export function createSubject(
  fixture: MonthlyBudgetFixture,
): MonthlyBudgetSubject {
  return createMonthlyBudgetFixtureSubject(fixture);
}

describe("월 예산 조회 공개 계약", () => {
  it("[T-BUD-001][BUD-001/BUD-002] 모든 cursor page를 읽고 예산 지출과 전체 지출을 구분해 계산한다", async () => {
    const subject = createSubject({
      categories: [
        { categoryId: "food", budgetInWon: 100_000, active: true },
        { categoryId: "leisure", budgetInWon: null, active: true },
      ],
      ledgerPages: [
        [
          {
            transactionId: "tx-1",
            accountingDate: "2026-07-01",
            categoryId: "food",
            amountInWon: 10_000,
          },
        ],
        [
          {
            transactionId: "tx-2",
            accountingDate: "2026-07-10",
            categoryId: "food",
            amountInWon: 20_000,
          },
          {
            transactionId: "tx-3",
            accountingDate: "2026-07-11",
            categoryId: "leisure",
            amountInWon: 20_000,
          },
        ],
      ],
    });

    const result = await subject.getMonthlyBudget("2026-07");

    expect(result).toEqual({
      kind: "success",
      value: {
        month: "2026-07",
        totalBudget: 100_000,
        budgetedCategoryExpense: 30_000,
        totalExpense: 50_000,
        remainingBudget: 70_000,
        categories: [
          {
            categoryId: "food",
            budgetInWon: 100_000,
            spentInWon: 30_000,
            progress: 0.3,
            overrunInWon: 0,
          },
          {
            categoryId: "leisure",
            budgetInWon: null,
            spentInWon: 20_000,
            progress: null,
            overrunInWon: 0,
          },
        ],
      },
    });
  });

  it("[T-BUD-001][BUD-001] 예산 0원은 진행률을 만들지 않지만 전체 지출에는 포함한다", async () => {
    const result = await createSubject({
      categories: [{ categoryId: "zero", budgetInWon: 0, active: true }],
      ledgerPages: [
        [
          {
            transactionId: "tx-zero",
            accountingDate: "2026-07-01",
            categoryId: "zero",
            amountInWon: 1_000,
          },
        ],
      ],
    }).getMonthlyBudget("2026-07");

    expect(result).toEqual({
      kind: "success",
      value: expect.objectContaining({
        totalBudget: 0,
        budgetedCategoryExpense: 0,
        totalExpense: 1_000,
        remainingBudget: 0,
        categories: [
          expect.objectContaining({
            categoryId: "zero",
            progress: null,
          }),
        ],
      }),
    });
  });

  it("[T-BUD-001][BUD-001] 지출이 예산을 넘으면 비율을 자르지 않고 정확한 초과액을 반환한다", async () => {
    const result = await createSubject({
      categories: [
        { categoryId: "food", budgetInWon: 100_000, active: true },
      ],
      ledgerPages: [
        [
          {
            transactionId: "tx-over-budget",
            accountingDate: "2026-07-15",
            categoryId: "food",
            amountInWon: 125_001,
          },
        ],
      ],
    }).getMonthlyBudget("2026-07");

    expect(result).toEqual({
      kind: "success",
      value: expect.objectContaining({
        totalBudget: 100_000,
        budgetedCategoryExpense: 125_001,
        totalExpense: 125_001,
        remainingBudget: -25_001,
        categories: [
          expect.objectContaining({
            categoryId: "food",
            spentInWon: 125_001,
            progress: 1.25001,
            overrunInWon: 25_001,
          }),
        ],
      }),
    });
  });

  it("[T-BUD-001][BUD-002] inactive 카테고리 예산과 지출은 잔여 예산 계산에서 제외하되 월 총지출에는 포함한다", async () => {
    const result = await createSubject({
      categories: [
        { categoryId: "active", budgetInWon: 100_000, active: true },
        { categoryId: "archived", budgetInWon: 500_000, active: false },
      ],
      ledgerPages: [
        [
          {
            transactionId: "tx-active",
            accountingDate: "2026-07-10",
            categoryId: "active",
            amountInWon: 10_000,
          },
          {
            transactionId: "tx-archived",
            accountingDate: "2026-07-11",
            categoryId: "archived",
            amountInWon: 30_000,
          },
        ],
      ],
    }).getMonthlyBudget("2026-07");

    expect(result).toEqual({
      kind: "success",
      value: expect.objectContaining({
        totalBudget: 100_000,
        budgetedCategoryExpense: 10_000,
        totalExpense: 40_000,
        remainingBudget: 90_000,
      }),
    });
    if (result.kind === "success") {
      expect(result.value.categories.map(({ categoryId }) => categoryId)).toEqual([
        "active",
      ]);
    }
  });

  it("[T-BUD-001][DEC-048] 중간 page 실패를 읽은 범위의 부분 합계나 0원 성공으로 바꾸지 않는다", async () => {
    const result = await createSubject({
      categories: [{ categoryId: "food", budgetInWon: 100_000, active: true }],
      ledgerPages: [
        [
          {
            transactionId: "tx-1",
            accountingDate: "2026-07-01",
            categoryId: "food",
            amountInWon: 10_000,
          },
        ],
        [],
      ],
      failAtPage: 1,
    }).getMonthlyBudget("2026-07");

    expect(result).toEqual({
      kind: "retryable-failure",
      code: "LEDGER_PAGE_UNAVAILABLE",
    });
  });

  it("[T-BUD-001][DEC-048] page 사이 source window가 바뀌면 서로 다른 snapshot을 합산하지 않는다", async () => {
    const result = await createSubject({
      categories: [{ categoryId: "food", budgetInWon: 100_000, active: true }],
      ledgerPages: [[], []],
      sourceWindowChangesAtPage: 1,
    }).getMonthlyBudget("2026-07");

    expect(result).toEqual({
      kind: "contract-failure",
      code: "LEDGER_SOURCE_WINDOW_CHANGED",
    });
  });

  it("[T-BUD-001][DEC-048] 카테고리와 거래가 모두 없을 때만 NoData다", async () => {
    const result = await createSubject({
      categories: [],
      ledgerPages: [[]],
    }).getMonthlyBudget("2026-07");

    expect(result).toEqual({
      kind: "no-data",
      code: "NO_CATEGORIES_OR_TRANSACTIONS",
    });
  });
});
