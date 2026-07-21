import type {
  CaptureTransactionBranch,
  CaptureTransactionBranchResult,
} from "../in/captureBranchSubmissionInputPort";

export interface CaptureTransactionGatewayPort {
  record(input: {
    readonly householdId: string;
    readonly downstreamKey: string;
    readonly branch: CaptureTransactionBranch;
  }): Promise<CaptureTransactionBranchResult>;
}
