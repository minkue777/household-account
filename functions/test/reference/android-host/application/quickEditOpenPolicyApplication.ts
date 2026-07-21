import type {
  QuickEditOpenPolicyInputPort,
  QuickEditOpenSnapshot,
} from "./ports/in/quickEditOpenPolicyInputPort";

export function createQuickEditOpenPolicyApplication(): QuickEditOpenPolicyInputPort {
  let activeTransactionId: string | undefined;
  const pendingTransactionIds: string[] = [];

  return {
    open(input) {
      if (
        !input.saveReceiptConfirmed ||
        input.transactionResult.kind === "retryableFailure" ||
        input.transactionResult.kind === "rejected"
      ) {
        return { kind: "Suppressed", reason: "TRANSACTION_NOT_CONFIRMED" };
      }
      if (input.quickEditEnabled === false) {
        return { kind: "Suppressed", reason: "USER_DISABLED" };
      }
      if (!input.overlayPermission) {
        return { kind: "Suppressed", reason: "OVERLAY_PERMISSION_MISSING" };
      }
      if (!input.activeSession) {
        return { kind: "Suppressed", reason: "NO_ACTIVE_SESSION" };
      }
      if (
        input.transactionResult.kind === "duplicate" &&
        !input.transactionResult.editable
      ) {
        return { kind: "Suppressed", reason: "TRANSACTION_NOT_EDITABLE" };
      }

      const transactionId =
        input.transactionResult.kind === "created"
          ? input.transactionResult.transactionId
          : input.transactionResult.existingTransactionId;
      if (activeTransactionId === undefined) {
        activeTransactionId = transactionId;
        return { kind: "Opened", transactionId };
      }
      if (activeTransactionId === transactionId) {
        return { kind: "Opened", transactionId };
      }
      if (!pendingTransactionIds.includes(transactionId)) {
        pendingTransactionIds.push(transactionId);
      }
      return { kind: "Queued", transactionId };
    },
    snapshot(): QuickEditOpenSnapshot {
      return {
        ...(activeTransactionId === undefined ? {} : { activeTransactionId }),
        pendingTransactionIds: [...pendingTransactionIds],
      };
    },
  };
}
