export type StructuralOperation =
  | "split-items"
  | "reconfigure-monthly"
  | "collapse-monthly"
  | "merge"
  | "unmerge"
  | "cancel-captured-lineage";

export interface StructuralLedgerState {
  transactions: readonly {
    transactionId: string;
    householdId: string;
    lifecycleState: "active" | "superseded";
    aggregateVersion: number;
  }[];
  claims: readonly {
    claimId: string;
    householdId: string;
    state: "active" | "cancelled";
    version: number;
  }[];
  receipts: readonly string[];
  events: readonly string[];
}

export type StructuralMutationResult =
  | { kind: "Committed"; changedTransactionIds: readonly string[] }
  | { kind: "Forbidden"; code: "LEDGER_WRITE_FORBIDDEN" }
  | { kind: "NotFound" }
  | {
      kind: "Conflict";
      code: "VERSION_MISMATCH" | "LINEAGE_VERSION_MISMATCH";
    }
  | { kind: "RetryableFailure"; code: "LEDGER_UOW_COMMIT_FAILED" };
