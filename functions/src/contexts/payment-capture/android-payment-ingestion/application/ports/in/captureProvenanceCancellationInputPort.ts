import type {
  ApprovalCaptureInput,
  ApprovalCaptureResult,
  CancellationEvidence,
  ProvenanceCancellationResult,
} from "../../../domain/model/captureProvenance";

export interface CancelByProvenanceInput {
  readonly actor: {
    readonly householdId: string;
    readonly memberId: string;
  };
  readonly evidence: CancellationEvidence;
}

export interface CaptureProvenanceCancellationInputPort {
  captureApproval(input: ApprovalCaptureInput): ApprovalCaptureResult;
  cancel(input: CancelByProvenanceInput): ProvenanceCancellationResult;
  availableUserCommands(): readonly string[];
}
