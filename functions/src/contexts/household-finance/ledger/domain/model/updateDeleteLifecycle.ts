export interface MutableLedgerTransaction {
  transactionId: string;
  householdId: string;
  lifecycleState: "active" | "deleted";
  merchant: string;
  amountInWon: number;
  categoryId: string;
  memo: string;
  accountingDate: string;
  aggregateVersion: number;
}

export type LedgerUpdateDeleteResult =
  | { kind: "Updated"; transaction: MutableLedgerTransaction }
  | { kind: "Deleted"; transactionId: string; version: number }
  | { kind: "NotFound" }
  | { kind: "Forbidden" }
  | { kind: "Conflict"; code: "VERSION_MISMATCH"; currentVersion: number }
  | { kind: "ValidationError"; code: string }
  | { kind: "RetryableFailure"; code: string };

export interface LedgerUpdateDeleteSnapshot {
  transactions: readonly MutableLedgerTransaction[];
  events: readonly {
    eventName: "TransactionChanged.v1" | "TransactionDeleted.v1";
    transactionId: string;
    aggregateVersion: number;
  }[];
}
