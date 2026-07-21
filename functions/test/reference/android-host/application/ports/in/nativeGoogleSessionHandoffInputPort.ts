export const NATIVE_WEBVIEW_SESSION_MAX_TTL_MS = 5 * 60 * 1_000;

export type NativeGoogleAuthenticationResult =
  | {
      readonly kind: "Authenticated";
      readonly principalRef: string;
      readonly membershipRequired: true;
    }
  | { readonly kind: "Cancelled" }
  | { readonly kind: "Failed"; readonly code: "GOOGLE_AUTH_FAILED" };

export interface PrincipalBoundMembershipReceipt {
  readonly receiptId: string;
  readonly principalRef: string;
  readonly householdId: string;
  readonly memberId: string;
  readonly status: "active" | "deleted";
  readonly source: "trusted-membership-query";
}

export type MembershipLookupResult =
  | { readonly kind: "Found"; readonly receipt: PrincipalBoundMembershipReceipt }
  | { readonly kind: "Missing" }
  | { readonly kind: "Failed" };

export type MembershipHandoffResult =
  | {
      readonly kind: "SessionReady";
      readonly principalRef: string;
      readonly exchangeHandle: string;
      readonly expiresAt: string;
    }
  | {
      readonly kind: "Rejected";
      readonly code:
        | "AUTHENTICATION_REQUIRED"
        | "ACTIVE_MEMBERSHIP_REQUIRED"
        | "MEMBERSHIP_PRINCIPAL_MISMATCH"
        | "MEMBERSHIP_LOOKUP_FAILED";
    };

export interface NativeGoogleSessionMirror {
  readonly schemaVersion: 1;
  readonly sessionGeneration: string;
  readonly householdId: string;
  readonly memberId: string;
}

export interface NativeGoogleSessionState {
  readonly authSurface: "android-credential-manager";
  readonly firebaseAdapter: "android-native-sdk";
  readonly embeddedWebOauthOpened: false;
  readonly principalRef?: string;
  readonly sessionMirror?: NativeGoogleSessionMirror;
  readonly issuedExchangeHandles: readonly string[];
  readonly membershipLookupPrincipalRefs: readonly string[];
  readonly exposedBridgeValues: readonly string[];
}

export interface NativeGoogleSessionHandoffInputPort {
  authenticate(): Promise<NativeGoogleAuthenticationResult>;
  confirmMembership(): Promise<MembershipHandoffResult>;
  state(): NativeGoogleSessionState;
}
