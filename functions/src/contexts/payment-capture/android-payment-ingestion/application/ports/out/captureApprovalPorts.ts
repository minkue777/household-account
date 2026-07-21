export interface CaptureApprovalConfigurationPort {
  resolveForApproval(input: {
    readonly observationId: string;
    readonly householdId: string;
    readonly ownerMemberId: string;
  }): Promise<void>;
}

export interface CaptureApprovalCommitPort {
  create(input: {
    readonly observationId: string;
    readonly householdId: string;
    readonly creatorMemberId: string;
  }): Promise<{ readonly transactionId: string }>;
}
