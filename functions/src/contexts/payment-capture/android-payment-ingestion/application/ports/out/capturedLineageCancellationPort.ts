import type {
  CancellationExecutionActor,
  CancelCapturedLineageResult,
} from "../in/cancellationExecutionInputPort";

export interface CapturedLineageCancellationPort {
  cancel(input: {
    readonly actor: CancellationExecutionActor;
    readonly cancellationKey: string;
    readonly captureLineageId: string;
    readonly expectedLineageVersion: number;
  }): Promise<
    Exclude<
      CancelCapturedLineageResult,
      | { kind: "NotFound" }
      | { kind: "NeedsConfirmation" }
    > | { readonly kind: "NotFound"; readonly resource: "cancellationTarget" }
  >;
}
