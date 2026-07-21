import type {
  CaptureQueueEntry,
  EnqueueCaptureObservationResult,
} from "../../../domain/model/androidCaptureQueue";

export interface CaptureQueueEntryMetadata {
  readonly observationId: string;
  readonly queuedAt: string;
}

export type DecryptedCaptureQueueEntry =
  | { readonly kind: "Ready"; readonly entry: CaptureQueueEntry }
  | {
      readonly kind: "Unreadable";
      readonly reason: "KeyInvalidated" | "DecryptionFailed";
    };

export interface EncryptedObservationQueuePort {
  enqueue(entry: CaptureQueueEntry): EnqueueCaptureObservationResult;
  peekOldest(): CaptureQueueEntryMetadata | undefined;
  decrypt(observationId: string): DecryptedCaptureQueueEntry;
  replace(entry: CaptureQueueEntry): "stored" | "failed";
  delete(observationId: string): void;
  clear(): void;
}
