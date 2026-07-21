import { createParsedObservationClassificationApplication } from "../../src/contexts/payment-capture/android-payment-ingestion/application/parsedObservationClassificationApplication";
import type { CaptureBranchIdGenerator } from "../../src/contexts/payment-capture/android-payment-ingestion/application/ports/out/captureBranchIdGenerator";

export type {
  ParsedBalanceEvidence,
  ParsedCardEvidence,
  ParsedObservationClassificationInputPort,
  ParsedObservationClassificationResult,
  ParsedObservationInput,
  ParsedTransactionEvidence,
} from "../../src/contexts/payment-capture/android-payment-ingestion/public";

class SequenceCaptureBranchIdGenerator implements CaptureBranchIdGenerator {
  private sequence = 1;

  next(kind: "payment" | "balance"): string {
    const branchId = `${kind}-branch-${this.sequence}`;
    this.sequence += 1;
    return branchId;
  }
}

export function createParsedObservationClassificationDriver() {
  return createParsedObservationClassificationApplication(
    new SequenceCaptureBranchIdGenerator(),
  );
}
