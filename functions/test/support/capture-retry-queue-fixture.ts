import { createCaptureRetryQueueApplication } from "../reference/android-host/application/captureRetryQueueApplication";
import type { CaptureRetryQueueEntry } from "../reference/android-host/application/ports/in/captureRetryQueueInputPort";
import type {
  EncryptedCaptureRetryMetadata,
  EncryptedCaptureRetryQueuePort,
} from "../reference/android-host/application/ports/out/encryptedCaptureRetryQueuePort";

interface SealedEntry {
  readonly metadata: EncryptedCaptureRetryMetadata;
  readonly iv: string;
  readonly ciphertext: string;
}

function createEncryptedStoreFixture(): EncryptedCaptureRetryQueuePort {
  const entries: SealedEntry[] = [];
  let keyValid = true;
  let ivSequence = 0;

  return {
    async sealAndAppend(entry: CaptureRetryQueueEntry) {
      ivSequence += 1;
      entries.push({
        metadata: {
          idempotencyKey: entry.idempotencyKey,
          queuedAt: entry.queuedAt,
        },
        iv: `unique-iv-${ivSequence}`,
        ciphertext: `sealed:${entry.payload.contractVersion}:${entry.payload.observationId.length}`,
      });
    },
    peekMetadata() {
      return entries[0]?.metadata;
    },
    async deleteHead() {
      entries.shift();
    },
    async deleteAll() {
      entries.splice(0, entries.length);
    },
    entryCount() {
      return entries.length;
    },
    invalidateKey() {
      keyValid = false;
    },
    isKeyValid() {
      return keyValid;
    },
  };
}

export function createCaptureRetryQueueFixture() {
  return createCaptureRetryQueueApplication(createEncryptedStoreFixture());
}
