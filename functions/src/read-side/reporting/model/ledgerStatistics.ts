export type ReportingTransactionStatus =
  | "active"
  | "cancelled"
  | "deleted"
  | "superseded";

export interface LedgerStatisticsFact {
  transactionId: string;
  transactionType: "expense" | "income";
  status: ReportingTransactionStatus;
  accountingDate: string;
  amountInWon: number;
  categoryId: string;
}

export interface ReportingCategoryReference {
  categoryId: string;
  label: string;
}

export type LedgerStatisticsSourceResult =
  | {
      kind: "ready";
      sourceCheckpoint: string;
      observedAt: string;
      transactions: readonly LedgerStatisticsFact[];
    }
  | { kind: "no-data" }
  | { kind: "retryable-failure"; code: string }
  | { kind: "contract-failure"; code: string };

export interface LedgerStatisticsView {
  period: { startDate: string; endDate: string };
  totalExpenseInWon: number;
  monthly: ReadonlyArray<{ yearMonth: string; amountInWon: number }>;
  categories: ReadonlyArray<{
    categoryId: string;
    label: string;
    amountInWon: number;
    ratio: number;
  }>;
  sourceCheckpoint: string;
  updatedAt: string;
}

export type LedgerStatisticsResult =
  | { kind: "success"; value: LedgerStatisticsView }
  | Exclude<LedgerStatisticsSourceResult, { kind: "ready" }>;
