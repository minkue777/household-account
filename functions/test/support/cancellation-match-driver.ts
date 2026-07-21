import { createCancellationMatchApplication } from "../../src/contexts/payment-capture/android-payment-ingestion/application/cancellationMatchApplication";
import type { CancellationMatchInputPort } from "../../src/contexts/payment-capture/android-payment-ingestion/public";

export type {
  CancellationCandidateFact,
  CancellationCardEvidence,
  CancellationMatchInputPort,
  CancellationMatchResult,
  CancellationObservation,
  CancellationSearchWindow,
} from "../../src/contexts/payment-capture/android-payment-ingestion/public";

export function createCancellationMatchDriver(): CancellationMatchInputPort {
  return createCancellationMatchApplication();
}
