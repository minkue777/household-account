import type { CaptureConfigurationQueryPort } from "../contexts/payment-capture/android-payment-ingestion/application/ports/out/captureConfigurationQueryPort";
import type { CaptureLedgerPersistencePort } from "../contexts/payment-capture/android-payment-ingestion/application/ports/out/captureLedgerPersistencePort";
import type { CaptureSubmissionReceiptPort } from "../contexts/payment-capture/android-payment-ingestion/application/ports/out/captureSubmissionReceiptPort";
import { measureCurrentInteractiveLatency } from "../observability/interactiveLatency";

export function withCaptureReceiptLatency(
  delegate: CaptureSubmissionReceiptPort,
): CaptureSubmissionReceiptPort {
  return {
    claim: (input) =>
      measureCurrentInteractiveLatency("capture-receipt-claim", () =>
        delegate.claim(input),
      ),
    save: (receipt) =>
      measureCurrentInteractiveLatency("capture-receipt-save", () =>
        delegate.save(receipt),
      ),
  };
}

export function withCaptureConfigurationLatency(
  delegate: CaptureConfigurationQueryPort,
): CaptureConfigurationQueryPort {
  return {
    load: (input) =>
      measureCurrentInteractiveLatency("capture-configuration", () =>
        delegate.load(input),
      ),
  };
}

export function withCapturePersistenceLatency(
  delegate: CaptureLedgerPersistencePort,
): CaptureLedgerPersistencePort {
  return {
    recordApproval: (command) =>
      measureCurrentInteractiveLatency("capture-persistence", () =>
        delegate.recordApproval(command),
      ),
    cancel: (command) =>
      measureCurrentInteractiveLatency("capture-persistence", () =>
        delegate.cancel(command),
      ),
  };
}
