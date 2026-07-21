import { classifyParsedObservation } from "../domain/policies/classifyParsedObservation";
import type { ParsedObservationClassificationInputPort } from "./ports/in/parsedObservationClassificationInputPort";
import type { CaptureBranchIdGenerator } from "./ports/out/captureBranchIdGenerator";

export function createParsedObservationClassificationApplication(
  branchIds: CaptureBranchIdGenerator,
): ParsedObservationClassificationInputPort {
  return {
    classify: (input) =>
      classifyParsedObservation(input, {
        paymentBranchId:
          input.transactionCandidate === undefined
            ? undefined
            : branchIds.next("payment"),
        balanceBranchId:
          input.balanceCandidate === undefined
            ? undefined
            : branchIds.next("balance"),
      }),
  };
}
