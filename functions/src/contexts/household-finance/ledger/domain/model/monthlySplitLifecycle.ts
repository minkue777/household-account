export interface SplitTransaction {
  transactionId: string;
  householdId: string;
  transactionType: "expense" | "income";
  lifecycleState: "active" | "superseded";
  amountInWon: number;
  accountingDate: string;
  merchant: string;
  categoryId: string;
  memo: string;
  cardType: string;
  cardDisplay: string;
  creatorMemberId: string;
  source: string;
  originChannel: string;
  aggregateVersion: number;
  splitGroup?: {
    groupId: string;
    index: number;
    total: number;
    originalId: string;
  };
}

export type SplitLifecycleResult =
  | { kind: "success"; transactionIds: readonly string[] }
  | { kind: "validation-error"; code: string }
  | { kind: "conflict"; code: string }
  | { kind: "retryable-failure"; code: string };
