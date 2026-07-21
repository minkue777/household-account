import type { CancellationMatchResult } from "./cancellationMatchInputPort";

export interface CancellationExecutionActor {
  readonly householdId: string;
  readonly memberId: string;
}

export interface ExecuteMatchedCancellationCommand {
  readonly actor: CancellationExecutionActor;
  readonly cancellationKey: string;
  readonly matchResult: CancellationMatchResult;
  readonly expectedLineageVersion: number;
}

export type CancelCapturedLineageResult =
  | {
      readonly kind: "Cancelled";
      readonly captureLineageId: string;
      readonly deletedTransactionIds: readonly string[];
      readonly groupId?: string;
    }
  | { readonly kind: "AlreadyCancelled"; readonly captureLineageId: string }
  | { readonly kind: "NotFound"; readonly resource: "cancellationTarget" }
  | {
      readonly kind: "NeedsConfirmation";
      readonly captureLineageIds: readonly string[];
    }
  | {
      readonly kind: "RetryableFailure";
      readonly code: "ATOMIC_COMMIT_FAILED";
    }
  | { readonly kind: "Conflict"; readonly code: "VERSION_MISMATCH" };

export interface CancellationExecutionInputPort {
  cancel(
    input: ExecuteMatchedCancellationCommand,
  ): Promise<CancelCapturedLineageResult>;
}
