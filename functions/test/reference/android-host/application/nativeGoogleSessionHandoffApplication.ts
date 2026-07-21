import type {
  MembershipHandoffResult,
  NativeGoogleSessionHandoffInputPort,
  NativeGoogleSessionMirror,
  NativeGoogleSessionState,
  PrincipalBoundMembershipReceipt,
} from "./ports/in/nativeGoogleSessionHandoffInputPort";
import { NATIVE_WEBVIEW_SESSION_MAX_TTL_MS } from "./ports/in/nativeGoogleSessionHandoffInputPort";
import type {
  NativeGoogleAuthPort,
  NativeSessionGenerationPort,
  NativeSessionMirrorWriterPort,
  PrincipalMembershipLookupPort,
  WebViewSessionExchangeIssuerPort,
} from "./ports/out/nativeGoogleSessionHandoffPorts";

function snapshot(state: NativeGoogleSessionState): NativeGoogleSessionState {
  return {
    authSurface: state.authSurface,
    firebaseAdapter: state.firebaseAdapter,
    embeddedWebOauthOpened: false,
    principalRef: state.principalRef,
    sessionMirror:
      state.sessionMirror === undefined ? undefined : { ...state.sessionMirror },
    issuedExchangeHandles: [...state.issuedExchangeHandles],
    membershipLookupPrincipalRefs: [...state.membershipLookupPrincipalRefs],
    exposedBridgeValues: [...state.exposedBridgeValues],
  };
}

function isStructurallyTrustedReceipt(
  receipt: PrincipalBoundMembershipReceipt,
): boolean {
  return (
    receipt.source === "trusted-membership-query" &&
    receipt.receiptId.trim() !== "" &&
    receipt.principalRef.trim() !== "" &&
    receipt.householdId.trim() !== "" &&
    receipt.memberId.trim() !== ""
  );
}

function effectiveTtl(requestedTtlMs: number | undefined): number {
  if (
    requestedTtlMs === undefined ||
    !Number.isFinite(requestedTtlMs) ||
    requestedTtlMs <= 0
  ) {
    return NATIVE_WEBVIEW_SESSION_MAX_TTL_MS;
  }
  return Math.min(
    NATIVE_WEBVIEW_SESSION_MAX_TTL_MS,
    Math.max(1, Math.floor(requestedTtlMs)),
  );
}

export function createNativeGoogleSessionHandoffApplication(dependencies: {
  readonly nativeAuthentication: NativeGoogleAuthPort;
  readonly memberships: PrincipalMembershipLookupPort;
  readonly exchangeHandles: WebViewSessionExchangeIssuerPort;
  readonly mirrorWriter: NativeSessionMirrorWriterPort;
  readonly sessionGenerations: NativeSessionGenerationPort;
  readonly requestedExchangeHandleTtlMs?: number;
}): NativeGoogleSessionHandoffInputPort {
  let state: NativeGoogleSessionState = {
    authSurface: "android-credential-manager",
    firebaseAdapter: "android-native-sdk",
    embeddedWebOauthOpened: false,
    principalRef: undefined,
    sessionMirror: undefined,
    issuedExchangeHandles: [],
    membershipLookupPrincipalRefs: [],
    exposedBridgeValues: [],
  };

  return {
    async authenticate() {
      const result = await dependencies.nativeAuthentication.authenticate();
      if (result.kind === "Cancelled") {
        state = { ...state, principalRef: undefined };
        return { kind: "Cancelled" };
      }
      if (
        result.kind === "Failed" ||
        result.principalRef.trim() === ""
      ) {
        state = { ...state, principalRef: undefined };
        return { kind: "Failed", code: "GOOGLE_AUTH_FAILED" };
      }

      state = { ...state, principalRef: result.principalRef };
      return {
        kind: "Authenticated",
        principalRef: result.principalRef,
        membershipRequired: true,
      };
    },

    async confirmMembership(): Promise<MembershipHandoffResult> {
      const principalRef = state.principalRef;
      if (principalRef === undefined) {
        return { kind: "Rejected", code: "AUTHENTICATION_REQUIRED" };
      }

      state = {
        ...state,
        membershipLookupPrincipalRefs: [
          ...state.membershipLookupPrincipalRefs,
          principalRef,
        ],
      };
      const lookup = await dependencies.memberships.findByPrincipal(principalRef);
      if (lookup.kind === "Failed") {
        return { kind: "Rejected", code: "MEMBERSHIP_LOOKUP_FAILED" };
      }
      if (lookup.kind === "Missing" || lookup.receipt.status !== "active") {
        return { kind: "Rejected", code: "ACTIVE_MEMBERSHIP_REQUIRED" };
      }
      if (lookup.receipt.principalRef !== principalRef) {
        return {
          kind: "Rejected",
          code: "MEMBERSHIP_PRINCIPAL_MISMATCH",
        };
      }
      if (!isStructurallyTrustedReceipt(lookup.receipt)) {
        return { kind: "Rejected", code: "MEMBERSHIP_LOOKUP_FAILED" };
      }

      const issued = await dependencies.exchangeHandles.issue({
        principalRef,
        membershipReceiptId: lookup.receipt.receiptId,
        ttlMs: effectiveTtl(dependencies.requestedExchangeHandleTtlMs),
      });
      const mirror: NativeGoogleSessionMirror = {
        schemaVersion: 1,
        sessionGeneration: dependencies.sessionGenerations.next(),
        householdId: lookup.receipt.householdId,
        memberId: lookup.receipt.memberId,
      };
      await dependencies.mirrorWriter.replace(mirror);

      state = {
        ...state,
        sessionMirror: mirror,
        issuedExchangeHandles: [
          ...state.issuedExchangeHandles,
          issued.handle,
        ],
      };
      return {
        kind: "SessionReady",
        principalRef,
        exchangeHandle: issued.handle,
        expiresAt: issued.expiresAt,
      };
    },

    state: () => snapshot(state),
  };
}
