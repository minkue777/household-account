export interface CaptureRetryQueueEntry {
  readonly sessionGeneration: string;
  readonly householdId: string;
  readonly memberId: string;
  readonly idempotencyKey: string;
  readonly queuedAt: string;
  readonly payload: {
    readonly contractVersion: "capture-envelope.v1";
    readonly observationId: string;
  };
}

export type CaptureRetryDecision =
  | { readonly kind: "Dispatch"; readonly idempotencyKey: string }
  | { readonly kind: "ExpiredAndDeleted" }
  | { readonly kind: "DeletedForInvalidKey" }
  | { readonly kind: "NoEntry" };

export interface CaptureRetryQueueState {
  readonly entryCount: number;
  readonly atRest: {
    readonly encryption: "AES-256-GCM";
    readonly uniqueIvPerEntry: true;
    readonly keyLocation: "AndroidKeystore";
    readonly keyExportable: false;
    readonly backupEligible: false;
    readonly plaintextPayloadPresent: false;
  };
}

export interface CaptureRetryQueueInputPort {
  enqueue(entry: CaptureRetryQueueEntry): Promise<void>;
  retryAt(now: string): Promise<CaptureRetryDecision>;
  invalidateEncryptionKey(): void;
  state(): CaptureRetryQueueState;
}
