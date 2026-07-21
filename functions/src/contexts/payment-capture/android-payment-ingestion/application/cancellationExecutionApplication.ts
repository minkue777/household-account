import type {
  CancellationExecutionInputPort,
  CancelCapturedLineageResult,
  ExecuteMatchedCancellationCommand,
} from "./ports/in/cancellationExecutionInputPort";
import type { CapturedLineageCancellationPort } from "./ports/out/capturedLineageCancellationPort";

class DefaultCancellationExecutionApplication
  implements CancellationExecutionInputPort
{
  constructor(private readonly ledger: CapturedLineageCancellationPort) {}

  cancel(
    input: ExecuteMatchedCancellationCommand,
  ): Promise<CancelCapturedLineageResult> {
    if (input.matchResult.kind === "notFound") {
      return Promise.resolve({
        kind: "NotFound",
        resource: "cancellationTarget",
      });
    }
    if (input.matchResult.kind === "needsConfirmation") {
      return Promise.resolve({
        kind: "NeedsConfirmation",
        captureLineageIds: [...input.matchResult.captureLineageIds],
      });
    }

    return this.ledger.cancel({
      actor: input.actor,
      cancellationKey: input.cancellationKey,
      captureLineageId: input.matchResult.captureLineageId,
      expectedLineageVersion: input.expectedLineageVersion,
    });
  }
}

export function createCancellationExecutionApplication(
  ledger: CapturedLineageCancellationPort,
): CancellationExecutionInputPort {
  return new DefaultCancellationExecutionApplication(ledger);
}
