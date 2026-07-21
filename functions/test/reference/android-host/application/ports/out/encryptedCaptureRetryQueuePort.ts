import type { CaptureRetryQueueEntry } from "../in/captureRetryQueueInputPort";

export interface EncryptedCaptureRetryMetadata {
  readonly idempotencyKey: string;
  readonly queuedAt: string;
}

export interface EncryptedCaptureRetryQueuePort {
  sealAndAppend(entry: CaptureRetryQueueEntry): Promise<void>;
  peekMetadata(): EncryptedCaptureRetryMetadata | undefined;
  deleteHead(): Promise<void>;
  deleteAll(): Promise<void>;
  entryCount(): number;
  invalidateKey(): void;
  isKeyValid(): boolean;
}
