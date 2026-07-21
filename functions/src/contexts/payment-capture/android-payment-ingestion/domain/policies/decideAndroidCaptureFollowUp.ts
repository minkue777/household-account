import type {
  AndroidCaptureFollowUpResult,
  FinalizeAndroidCaptureInput,
} from "../model/androidCaptureFollowUp";

export function decideAndroidCaptureFollowUp(
  input: FinalizeAndroidCaptureInput,
): AndroidCaptureFollowUpResult {
  const transaction = input.transactionResult;
  if (
    transaction.kind === "created" &&
    (transaction.creatorMemberId === undefined ||
      transaction.creatorMemberId.trim() === "")
  ) {
    return { kind: "Rejected", code: "CREATOR_MEMBER_REQUIRED" };
  }

  if (!input.receiptConfirmed || transaction.kind === "retryableFailure") {
    return { kind: "PendingRetry" };
  }

  if (transaction.kind === "created") {
    return {
      kind: "Completed",
      editableTransactionId: transaction.transactionId,
    };
  }
  if (transaction.kind === "duplicate" && transaction.editable) {
    return {
      kind: "Completed",
      editableTransactionId: transaction.existingTransactionId,
    };
  }

  return { kind: "Completed" };
}
