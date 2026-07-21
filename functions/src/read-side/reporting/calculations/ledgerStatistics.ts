import type {
  LedgerStatisticsResult,
  LedgerStatisticsSourceResult,
  ReportingCategoryReference,
} from "../model/ledgerStatistics";

interface YearMonth {
  year: number;
  month: number;
}

function parseYearMonth(localDate: string): YearMonth {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(localDate);
  if (match === null) throw new Error("YYYY-MM-DD 날짜가 필요합니다.");
  return { year: Number(match[1]), month: Number(match[2]) };
}

function compare(left: YearMonth, right: YearMonth): number {
  return left.year * 12 + left.month - (right.year * 12 + right.month);
}

function next(value: YearMonth): YearMonth {
  return value.month === 12
    ? { year: value.year + 1, month: 1 }
    : { year: value.year, month: value.month + 1 };
}

function format(value: YearMonth): string {
  return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}`;
}

export function calculateLedgerStatistics(input: {
  source: Extract<LedgerStatisticsSourceResult, { kind: "ready" }>;
  categories: readonly ReportingCategoryReference[];
  period: { startDate: string; endDate: string };
}): LedgerStatisticsResult {
  const monthlyAmounts = new Map<string, number>();
  const firstMonth = parseYearMonth(input.period.startDate);
  const lastMonth = parseYearMonth(input.period.endDate);
  for (
    let month = firstMonth;
    compare(month, lastMonth) <= 0;
    month = next(month)
  ) {
    monthlyAmounts.set(format(month), 0);
  }

  const categoryAmounts = new Map<string, number>();
  let totalExpenseInWon = 0;
  for (const transaction of input.source.transactions) {
    if (
      transaction.transactionType !== "expense" ||
      transaction.status !== "active" ||
      transaction.accountingDate < input.period.startDate ||
      transaction.accountingDate > input.period.endDate
    ) {
      continue;
    }
    const month = transaction.accountingDate.slice(0, 7);
    monthlyAmounts.set(
      month,
      (monthlyAmounts.get(month) ?? 0) + transaction.amountInWon,
    );
    categoryAmounts.set(
      transaction.categoryId,
      (categoryAmounts.get(transaction.categoryId) ?? 0) +
        transaction.amountInWon,
    );
    totalExpenseInWon += transaction.amountInWon;
  }

  const categoryLabels = new Map(
    input.categories.map((category) => [category.categoryId, category.label]),
  );
  const categories = [...categoryAmounts.entries()]
    .map(([categoryId, amountInWon]) => ({
      categoryId,
      label: categoryLabels.get(categoryId) ?? categoryId,
      amountInWon,
      ratio: totalExpenseInWon === 0 ? 0 : amountInWon / totalExpenseInWon,
    }))
    .sort(
      (left, right) =>
        right.amountInWon - left.amountInWon ||
        left.categoryId.localeCompare(right.categoryId),
    );

  return {
    kind: "success",
    value: {
      period: input.period,
      totalExpenseInWon,
      monthly: [...monthlyAmounts].map(([yearMonth, amountInWon]) => ({
        yearMonth,
        amountInWon,
      })),
      categories,
      sourceCheckpoint: input.source.sourceCheckpoint,
      updatedAt: input.source.observedAt,
    },
  };
}
