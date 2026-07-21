export interface ReportingRequestIdentity {
  actorSessionGeneration: string;
  householdId: string;
  queryKey: string;
  queryRevision: number;
}

export interface BoundedLedgerStatisticsFact {
  transactionId: string;
  accountingDate: string;
  amountInWon: number;
  transactionType: "expense" | "income";
}

export interface LedgerSourcePage {
  cursor?: string;
  nextCursor?: string;
  sourceCheckpoint: string;
  items: readonly BoundedLedgerStatisticsFact[];
}

export type BoundedLedgerSourceResponse =
  | { kind: "ready"; pages: readonly LedgerSourcePage[] }
  | { kind: "retryable-failure"; code: string }
  | { kind: "contract-failure"; code: string };

export interface BoundedReportingView {
  identity: ReportingRequestIdentity;
  totalExpenseInWon: number;
  sourceCheckpoint: string;
  rowCount: number;
}

export type BoundedReportingResult =
  | { kind: "success"; value: BoundedReportingView }
  | { kind: "retryable-failure"; code: string }
  | { kind: "contract-failure"; code: string };
