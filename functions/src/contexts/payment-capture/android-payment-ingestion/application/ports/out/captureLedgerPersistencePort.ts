import type { CaptureTransactionBranchResult } from "../in/captureBranchSubmissionInputPort";

export interface CaptureApprovalPersistenceCommand {
  readonly householdId: string;
  readonly downstreamKey: string;
  readonly branch: {
    readonly observationId: string;
    readonly originChannel: "android-notification" | "ios-shortcut";
    readonly creatorMemberId: string;
    readonly sourceType: string;
    readonly parser: { readonly parserId: string; readonly parserVersion: string };
    readonly rawPayloadHash: string;
    readonly occurredAt: string;
    readonly accountingDate: string;
    readonly amountInWon: number;
    readonly originalMerchant: string;
    readonly merchant: string;
    readonly categoryId: string;
    readonly memo: string;
    readonly cardEvidence?: {
      readonly companyLabel: string;
      readonly maskedToken?: string;
    };
    readonly canonicalCardId?: string;
    readonly localCurrencyType?: "gyeonggi" | "daejeon" | "sejong";
  };
}

export interface CaptureCancellationPersistenceCommand {
  readonly householdId: string;
  readonly downstreamKey: string;
  readonly branch: {
    readonly observationId: string;
    readonly creatorMemberId: string;
    readonly sourceType: string;
    readonly parser: { readonly parserId: string; readonly parserVersion: string };
    readonly rawPayloadHash: string;
    readonly observedAt: string;
    readonly cancellationDate: string;
    readonly amountInWon: number;
    readonly merchant: string;
    readonly cardEvidence?: {
      readonly companyLabel: string;
      readonly maskedToken?: string;
    };
    readonly canonicalCardId?: string;
  };
}

export interface CaptureLedgerPersistencePort {
  recordApproval(
    command: CaptureApprovalPersistenceCommand,
  ): Promise<CaptureTransactionBranchResult>;
  cancel(
    command: CaptureCancellationPersistenceCommand,
  ): Promise<CaptureTransactionBranchResult>;
}
