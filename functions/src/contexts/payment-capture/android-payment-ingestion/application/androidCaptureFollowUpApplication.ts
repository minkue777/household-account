import { decideAndroidCaptureFollowUp } from "../domain/policies/decideAndroidCaptureFollowUp";
import type { AndroidCaptureFollowUpInputPort } from "./ports/in/androidCaptureFollowUpInputPort";
import type {
  AndroidCaptureCompletionPort,
  AndroidQuickEditPort,
} from "./ports/out/androidCaptureFollowUpEffects";

export interface AndroidCaptureFollowUpDependencies {
  readonly quickEdit: AndroidQuickEditPort;
  readonly completion: AndroidCaptureCompletionPort;
}

export function createAndroidCaptureFollowUpApplication(
  dependencies: AndroidCaptureFollowUpDependencies,
): AndroidCaptureFollowUpInputPort {
  return {
    finalize: (input) => {
      const result = decideAndroidCaptureFollowUp(input);
      if (
        result.kind === "Completed" &&
        result.editableTransactionId !== undefined
      ) {
        dependencies.quickEdit.open(result.editableTransactionId);
        dependencies.completion.broadcast(result.editableTransactionId);
      }
      return result;
    },
  };
}
