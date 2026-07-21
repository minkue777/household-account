export type AndroidTransactionBranchResult =
  | {
      readonly kind: "created";
      readonly transactionId: string;
      readonly editable: true;
      readonly creatorMemberId?: string;
    }
  | {
      readonly kind: "duplicate";
      readonly existingTransactionId: string;
      readonly editable: boolean;
    }
  | { readonly kind: "rejected"; readonly code: string }
  | { readonly kind: "retryableFailure"; readonly code: string };

export interface FinalizeAndroidCaptureInput {
  readonly transactionResult: AndroidTransactionBranchResult;
  readonly receiptConfirmed: boolean;
}

export type AndroidCaptureFollowUpResult =
  | { readonly kind: "Completed"; readonly editableTransactionId?: string }
  | { readonly kind: "Rejected"; readonly code: "CREATOR_MEMBER_REQUIRED" }
  | { readonly kind: "PendingRetry" };
