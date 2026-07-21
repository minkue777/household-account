export interface QuickEditOpenInput {
  readonly transactionResult:
    | { readonly kind: "created"; readonly transactionId: string }
    | {
        readonly kind: "duplicate";
        readonly existingTransactionId: string;
        readonly editable: boolean;
      }
    | { readonly kind: "rejected" }
    | { readonly kind: "retryableFailure" };
  readonly saveReceiptConfirmed: boolean;
  readonly quickEditEnabled?: boolean;
  readonly overlayPermission: boolean;
  readonly activeSession: boolean;
}

export type QuickEditOpenResult =
  | { readonly kind: "Opened"; readonly transactionId: string }
  | { readonly kind: "Queued"; readonly transactionId: string }
  | {
      readonly kind: "Suppressed";
      readonly reason:
        | "TRANSACTION_NOT_CONFIRMED"
        | "USER_DISABLED"
        | "OVERLAY_PERMISSION_MISSING"
        | "NO_ACTIVE_SESSION"
        | "TRANSACTION_NOT_EDITABLE";
    };

export interface QuickEditOpenSnapshot {
  readonly activeTransactionId?: string;
  readonly pendingTransactionIds: readonly string[];
}

export interface QuickEditOpenPolicyInputPort {
  open(input: QuickEditOpenInput): QuickEditOpenResult;
  snapshot(): QuickEditOpenSnapshot;
}
