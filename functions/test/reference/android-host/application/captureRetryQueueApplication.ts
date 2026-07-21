import type {
  CaptureRetryQueueInputPort,
  CaptureRetryQueueState,
} from "./ports/in/captureRetryQueueInputPort";
import type { EncryptedCaptureRetryQueuePort } from "./ports/out/encryptedCaptureRetryQueuePort";

const RETENTION_MILLISECONDS = 72 * 60 * 60 * 1_000;

export function createCaptureRetryQueueApplication(
  queue: EncryptedCaptureRetryQueuePort,
): CaptureRetryQueueInputPort {
  return {
    enqueue(entry) {
      return queue.sealAndAppend(entry);
    },

    async retryAt(now) {
      const head = queue.peekMetadata();
      if (head === undefined) return { kind: "NoEntry" };

      if (!queue.isKeyValid()) {
        await queue.deleteAll();
        return { kind: "DeletedForInvalidKey" };
      }

      if (Date.parse(now) - Date.parse(head.queuedAt) >= RETENTION_MILLISECONDS) {
        await queue.deleteHead();
        return { kind: "ExpiredAndDeleted" };
      }

      return { kind: "Dispatch", idempotencyKey: head.idempotencyKey };
    },

    invalidateEncryptionKey() {
      queue.invalidateKey();
    },

    state(): CaptureRetryQueueState {
      return {
        entryCount: queue.entryCount(),
        atRest: {
          encryption: "AES-256-GCM",
          uniqueIvPerEntry: true,
          keyLocation: "AndroidKeystore",
          keyExportable: false,
          backupEligible: false,
          plaintextPayloadPresent: false,
        },
      };
    },
  };
}
