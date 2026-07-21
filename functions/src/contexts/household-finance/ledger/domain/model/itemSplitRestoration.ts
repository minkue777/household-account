export interface ItemSplitTransaction {
  transactionId: string;
  householdId: string;
  lifecycleState: "active" | "superseded";
  merchant: string;
  amountInWon: number;
  categoryId: string;
  memo: string;
  source: string;
  originChannel: string;
  creatorMemberId: string;
  cardEvidence: string;
  captureLineageId: string;
  aggregateVersion: number;
  derivedFromTransactionId?: string;
}

export interface ItemSplitSnapshot {
  transactions: readonly ItemSplitTransaction[];
  dedupClaims: readonly {
    fingerprint: string;
    captureLineageId: string;
    state: "active" | "cancelled";
  }[];
}

export type ItemSplitResult =
  | { kind: "Split"; sourceId: string; derivedIds: readonly string[] }
  | { kind: "Restored"; transactionId: string }
  | {
      kind: "ValidationError";
      code:
        | "ITEM_SPLIT_REQUIRES_AT_LEAST_TWO_ITEMS"
        | "ITEM_AMOUNT_NOT_POSITIVE_INTEGER"
        | "SPLIT_SUM_MISMATCH";
    }
  | { kind: "Conflict"; code: "VERSION_MISMATCH" }
  | { kind: "RetryableFailure"; code: string };
