export type LedgerSearchTransactionType = "expense" | "income";
export type LedgerSearchTransactionStatus =
  | "active"
  | "cancelled"
  | "deleted"
  | "superseded";

export interface LedgerSearchFact {
  transactionId: string;
  householdId: string;
  transactionType: LedgerSearchTransactionType;
  status: LedgerSearchTransactionStatus;
  accountingDate: string;
  localTime: string;
  merchant: string;
  memo: string;
  amountInWon: number;
  cardEvidence?: {
    companyCode: string;
    companyLabel: string;
    lastFour?: string;
  };
}

export type LedgerSearchSourceResult =
  | {
      kind: "ready";
      sourceCheckpoint: string;
      pages: ReadonlyArray<readonly LedgerSearchFact[]>;
    }
  | { kind: "retryable-failure"; code: string }
  | { kind: "contract-failure"; code: string };

export interface LedgerSearchItem {
  transactionId: string;
  accountingDate: string;
  localTime: string;
  amountInWon: number;
}

export interface LedgerSearchSummary {
  totalCount: number;
  totalAmountInWon: number;
  monthly: ReadonlyArray<{
    yearMonth: string;
    count: number;
    amountInWon: number;
  }>;
}

export type SearchLedgerResult =
  | {
      kind: "success";
      items: readonly LedgerSearchItem[];
      nextCursor?: string;
      summary: LedgerSearchSummary;
      sourceCheckpoint: string;
    }
  | { kind: "no-data" }
  | { kind: "retryable-failure"; code: string }
  | { kind: "contract-failure"; code: string };
