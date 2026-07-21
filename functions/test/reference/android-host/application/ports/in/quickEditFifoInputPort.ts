export interface QuickEditSessionScope {
  readonly sessionGeneration: string;
  readonly householdId: string;
  readonly memberId: string;
}

export interface StoredQuickEditTransactionSignal {
  readonly transactionId: string;
  readonly savedAt: string;
  readonly displaySnapshot: {
    readonly merchant: string;
    readonly amountInWon: number;
    readonly categoryId: string;
    readonly memo: string;
  };
}

export interface PersistedQuickEditQueueEntry {
  readonly sessionGeneration: string;
  readonly householdId: string;
  readonly memberId: string;
  readonly transactionId: string;
  readonly sequence: number;
  readonly enqueuedAt: string;
}

export type QuickEditPresentationCheck =
  | "active-and-authorized"
  | "stale"
  | "unauthorized"
  | "not-editable";

export type QuickEditQueueOpenOutcome =
  | { readonly kind: "Opened"; readonly transactionId: string }
  | { readonly kind: "Queued"; readonly transactionId: string }
  | { readonly kind: "AlreadyQueued"; readonly transactionId: string }
  | { readonly kind: "StorageFailure"; readonly code: "QUEUE_WRITE_FAILED" };

export type QuickEditQueueFinishOutcome =
  | { readonly kind: "Advanced"; readonly nextTransactionId: string }
  | { readonly kind: "QueueDrained" }
  | { readonly kind: "Retained"; readonly transactionId: string };

export interface QuickEditQueueSnapshot {
  readonly currentTransactionId?: string;
  readonly pendingTransactionIds: readonly string[];
  readonly persistedEntries: readonly PersistedQuickEditQueueEntry[];
  readonly presentedTransactionIds: readonly string[];
  readonly skippedTransactionIds: readonly string[];
}

export interface QuickEditQueueSecurityEvidence {
  readonly storageProtection: "android-keystore-backed-encryption";
  readonly keyExportable: false;
  readonly backupEligible: false;
  readonly persistedFieldNames: readonly string[];
  readonly containsDisplaySnapshotPlaintext: false;
}

export interface QuickEditFifoInputPort {
  signalStoredTransaction(
    signal: StoredQuickEditTransactionSignal,
  ): Promise<QuickEditQueueOpenOutcome>;
  finishCurrent(
    result:
      | "success"
      | "already-processed"
      | "explicit-close"
      | "conflict"
      | "retryable-failure",
  ): Promise<QuickEditQueueFinishOutcome>;
  restartProcess(at?: string): Promise<void>;
  setNextQueueWriteResult(result: "success" | "failure"): void;
  state(): QuickEditQueueSnapshot;
  securityEvidence(): QuickEditQueueSecurityEvidence;
}
