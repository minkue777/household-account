export type LedgerTransactionType = "expense" | "income";

export interface LedgerTransactionView {
  transactionId: string;
  householdId: string;
  transactionType: LedgerTransactionType;
  merchant: string;
  memo: string;
  amountInWon: number;
  categoryId: string;
  accountingDate: string;
  localTime: string;
  cardDisplay: string;
  cardType: "manual" | "captured";
  source?: string;
  creatorMemberId: string;
  lifecycleState: "active" | "deleted";
  aggregateVersion: number;
  notificationRequest?: {
    requesterMemberId: string;
    requestedAt: string;
  };
}

export interface LedgerEvent {
  type: string;
  transactionId: string;
  requesterMemberId?: string;
}

export type LedgerCommandResult =
  | { kind: "success"; value: LedgerTransactionView }
  | { kind: "validation-error"; code: string }
  | { kind: "conflict"; code: string; currentVersion?: number }
  | { kind: "not-found" }
  | { kind: "retryable-failure"; code: string };

export type LedgerSummaryResult =
  | {
      kind: "success";
      selectedDateAmountInWon: number;
      monthAmountInWon: number;
      yearAmountInWon: number;
      categories: readonly { categoryId: string; amountInWon: number }[];
    }
  | { kind: "no-data" }
  | { kind: "retryable-failure"; code: string };
