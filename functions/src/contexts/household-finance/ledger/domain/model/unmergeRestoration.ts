export interface UnmergeLeafSnapshot {
  transactionId?: string;
  merchant: string;
  amountInWon: number;
  categoryId: string;
  memo: string;
  source: string;
  originChannel: string;
  creatorMemberId: string;
  captureLineageId?: string;
  captureCardEvidence: string;
}

export interface UnmergeTransaction {
  transactionId: string;
  householdId: string;
  lifecycleState: "active" | "superseded";
  merchant: string;
  amountInWon: number;
  categoryId: string;
  memo: string;
  accountingDate: string;
  localTime: string;
  transactionType: "expense" | "income";
  cardDisplay: string;
  source: string;
  originChannel: string;
  creatorMemberId: string;
  captureLineageId?: string;
  captureCardEvidence: string;
  aggregateVersion: number;
  mergeLeafSnapshots?: readonly UnmergeLeafSnapshot[];
}

export type UnmergeRestorationResult =
  | { kind: "Unmerged"; restoredTransactionIds: readonly string[] }
  | { kind: "ContractFailure"; code: "RESTORATION_SNAPSHOT_INCOMPLETE" }
  | { kind: "Conflict"; code: string }
  | { kind: "RetryableFailure"; code: string };
