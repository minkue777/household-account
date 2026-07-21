import {
  classifyGoldObservation,
  classifyQuoteObservation,
} from "../domain/externalResultClassification";
import type { ExternalResultClassificationInputPort } from "./ports/in/externalResultClassificationInputPort";
import type { ExternalOperationPort } from "./ports/out/externalOperationPort";

export function createExternalResultClassificationApplication(dependencies: {
  readonly operation: ExternalOperationPort<number>;
  readonly maxAttempts: number;
}): ExternalResultClassificationInputPort {
  return {
    mapQuoteObservation: classifyQuoteObservation,
    mapGoldObservation: classifyGoldObservation,
    async executeWithRetry() {
      const maxAttempts = Math.max(1, dependencies.maxAttempts);
      let attempts = 0;
      let result;
      do {
        attempts += 1;
        result = await dependencies.operation.execute();
      } while (result.kind === "RETRYABLE_FAILURE" && attempts < maxAttempts);
      return { result, attempts };
    },
  };
}
