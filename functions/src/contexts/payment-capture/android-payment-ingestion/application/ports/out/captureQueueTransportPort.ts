import type {
  CaptureQueueBranch,
  CaptureQueueServerBranchResult,
} from "../../../domain/model/androidCaptureQueue";

export interface CaptureQueueTransportPort {
  submit(input: {
    readonly observationId: string;
    readonly branch: CaptureQueueBranch;
  }): CaptureQueueServerBranchResult;
}
