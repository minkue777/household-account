export type SecureBridgeOperation =
  | "SYNC_SESSION_MIRROR"
  | "CLEAR_HOUSEHOLD_MIRROR"
  | "GET_QUICK_EDIT_PREFERENCE"
  | "SET_QUICK_EDIT_PREFERENCE"
  | "GET_APP_VERSION";

export type SecureBridgeResult =
  | { readonly kind: "Success"; readonly requestId: string }
  | {
      readonly kind: "Rejected";
      readonly requestId: string;
      readonly code:
        | "ORIGIN_NOT_ALLOWED"
        | "TOP_LEVEL_REQUIRED"
        | "VERSION_UNSUPPORTED"
        | "MEMBERSHIP_RECEIPT_REQUIRED"
        | "MEMBERSHIP_RECEIPT_INVALID"
        | "MEMBERSHIP_RECEIPT_ALREADY_USED";
    };

export type WebViewSessionExchangeResult =
  | { readonly kind: "SessionEstablished"; readonly principalRef: string }
  | {
      readonly kind: "Rejected";
      readonly code: "ORIGIN_NOT_ALLOWED" | "EXPIRED" | "ALREADY_USED";
    };

export interface SecureWebViewBridgeState {
  readonly acceptedSensitiveOperations: readonly SecureBridgeOperation[];
  readonly sessionMirror?: {
    readonly principalRef: string;
    readonly householdId: string;
    readonly memberId: string;
  };
  readonly establishedPrincipalRefs: readonly string[];
  readonly exposedCredentialValues: readonly string[];
}

export interface SecureWebViewBridgeInputPort {
  execute(input: {
    readonly requestId: string;
    readonly contractVersion: "v1" | "unknown";
    readonly topLevelDocumentUrl: string;
    readonly frame: "top-level" | "subframe";
    readonly operation: SecureBridgeOperation;
    readonly membershipReceiptId?: string;
    readonly at?: string;
  }): SecureBridgeResult;
  exchangeSession(input: {
    readonly topLevelDocumentUrl: string;
    readonly handle: string;
    readonly at: string;
  }): WebViewSessionExchangeResult;
  state(): SecureWebViewBridgeState;
}
