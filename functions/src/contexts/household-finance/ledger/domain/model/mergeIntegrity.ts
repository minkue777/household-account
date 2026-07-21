export interface MergeLeafSnapshot {
  transactionId: string;
  merchant: string;
  amountInWon: number;
  categoryId: string;
  memo: string;
  source: string;
  originChannel: string;
  creatorMemberId: string;
  captureLineageId: string;
}

export interface MergeTransaction {
  transactionId: string;
  householdId: string;
  lifecycleState: "active" | "superseded";
  merchant: string;
  amountInWon: number;
  categoryId: string;
  memo: string;
  accountingDate: string;
  localTime: string;
  transactionType: "expense";
  cardDisplay: string;
  source: string;
  originChannel: string;
  creatorMemberId: string;
  captureLineageId: string;
  aggregateVersion: number;
  mergeSnapshot?: readonly MergeLeafSnapshot[];
  mergeParentIds?: readonly string[];
}

export interface MergeIntegritySnapshot {
  transactions: readonly MergeTransaction[];
  events: readonly {
    eventName: "TransactionChanged.v1";
    transactionId: string;
  }[];
}

export type MergeIntegrityResult =
  | { kind: "Merged"; transactionId: string; leafIds: readonly string[] }
  | {
      kind: "Conflict";
      code: "MERGE_LEAF_OVERLAP" | "MERGE_ANCESTRY_CYCLE" | "VERSION_MISMATCH";
    }
  | { kind: "ContractFailure"; code: "RESTORATION_SNAPSHOT_INCOMPLETE" }
  | { kind: "RetryableFailure"; code: "LEDGER_UOW_COMMIT_FAILED" };
