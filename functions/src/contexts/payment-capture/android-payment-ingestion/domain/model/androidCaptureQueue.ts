export type CaptureQueueBranchName = "payment" | "balance";

export type CaptureQueueServerBranchResult =
  | { readonly kind: "Created"; readonly resourceId: string }
  | { readonly kind: "Duplicate"; readonly resourceId: string }
  | { readonly kind: "Rejected"; readonly code: string }
  | { readonly kind: "RetryableFailure"; readonly code: string };

export interface CaptureQueueBranch {
  readonly branch: CaptureQueueBranchName;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
}

export interface EnqueueCaptureObservationInput {
  readonly actor: {
    readonly householdId: string;
    readonly memberId: string;
  };
  readonly observationId: string;
  readonly queuedAt: string;
  readonly branches: readonly CaptureQueueBranch[];
}

export type EnqueueCaptureObservationResult =
  | { readonly kind: "Queued"; readonly observationId: string }
  | { readonly kind: "AlreadyQueued"; readonly observationId: string }
  | {
      readonly kind: "LocalFailure";
      readonly code: "INVALID_BRANCH_SET" | "ENCRYPTED_STORE_UNAVAILABLE";
    };

export interface TerminalCaptureQueueBranch {
  readonly branch: CaptureQueueBranchName;
  readonly idempotencyKey: string;
  readonly result: Exclude<
    CaptureQueueServerBranchResult,
    { kind: "RetryableFailure" }
  >;
}

export interface CaptureQueueEntry {
  readonly observationId: string;
  readonly actor: {
    readonly householdId: string;
    readonly memberId: string;
  };
  readonly queuedAt: string;
  readonly pendingBranches: readonly CaptureQueueBranch[];
  readonly terminalBranches: readonly TerminalCaptureQueueBranch[];
}

export interface CaptureQueueEntrySnapshot extends CaptureQueueEntry {
  readonly atRest: {
    readonly algorithm: "AES-256-GCM";
    readonly keyProvider: "AndroidKeystore";
    readonly ciphertextOnly: true;
  };
}

export interface CaptureQueueState {
  readonly entries: readonly CaptureQueueEntrySnapshot[];
  readonly transportAttempts: readonly {
    readonly observationId: string;
    readonly branch: CaptureQueueBranchName;
    readonly idempotencyKey: string;
  }[];
  readonly plaintextAtRest: readonly unknown[];
}

export type CaptureQueueDeletionReason =
  | "AllBranchesTerminal"
  | "Expired"
  | "SessionChanged"
  | "KeyInvalidated"
  | "DecryptionFailed";

export type FlushCaptureQueueResult = {
  readonly kind: "Idle" | "Retained" | "Deleted";
  readonly pendingBranches: readonly CaptureQueueBranchName[];
  readonly deletionReason?: CaptureQueueDeletionReason;
};
