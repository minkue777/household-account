export type SessionEndpointRemovalResult =
  | { kind: "removed" }
  | { kind: "already-absent" }
  | { kind: "retryable-failure"; code: string };

export type SessionEndpointRegistrationResult =
  | { kind: "registered"; endpointId: string }
  | { kind: "retryable-failure"; code: string };

export interface SessionScopeView {
  schemaVersion: "session-scope.v1";
  sessionGeneration: number;
  principalUid: string;
  householdId: string;
  actingMemberId: string;
  displayName: string;
}

/** 인증 Adapter가 Google ID token 검증 뒤에만 생성하는 내부 Principal입니다. */
export interface VerifiedSessionPrincipal {
  principalUid: string;
}

export type LogoutSessionResult =
  | { kind: "logged-out"; endpoint: "removed" | "already-absent" }
  | { kind: "retryable-failure"; code: string };

export type RestoreSessionResult =
  | {
      kind: "restored";
      session: SessionScopeView;
      notificationSync: SessionEndpointRegistrationResult;
    }
  | { kind: "conflict"; code: "HOUSEHOLD_NOT_ACTIVE" }
  | { kind: "unauthenticated"; code: string };

export interface SessionMembershipInputPort {
  supportedAccessCommands(): readonly string[];
  logoutHouseholdSession(): Promise<LogoutSessionResult>;
  restoreSignedInSession(
    principal: VerifiedSessionPrincipal,
  ): Promise<RestoreSessionResult>;
}
