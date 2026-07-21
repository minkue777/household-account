export interface LegacySessionCandidate {
  householdKey: string;
  currentMemberId: string;
  currentMemberName?: string;
}

export type CapturedLegacyCandidate =
  | { kind: "complete"; candidate: LegacySessionCandidate }
  | { kind: "absent" };

export interface LegacyMembershipView {
  householdId: string;
  memberId: string;
  principalUid: string;
  status: "active";
}

export type ResolveLegacyUserResult =
  | { kind: "membership-found"; membership: LegacyMembershipView }
  | { kind: "legacy-confirmation-required"; candidate: LegacySessionCandidate }
  | { kind: "first-visit-required"; choices: readonly ["create", "join"] }
  | { kind: "retryable-failure"; code: "MEMBERSHIP_LOOKUP_UNAVAILABLE" };

export type ClaimLegacySessionResult =
  | {
      kind: "membership-linked" | "already-linked";
      membership: LegacyMembershipView;
      session: {
        householdId: string;
        actingMemberId: string;
        principalUid: string;
      };
    }
  | { kind: "first-visit-required" }
  | {
      kind: "conflict";
      code: "PRINCIPAL_ALREADY_JOINED" | "MEMBER_ALREADY_LINKED";
    };

export interface VerifiedLegacyRecoveryOperator {
  principalRef: string;
  capabilities: readonly "admin.membership-claims.repair"[];
}

export type RepairLegacyMembershipResult =
  | { kind: "repaired"; membership: LegacyMembershipView }
  | { kind: "forbidden"; code: "RECOVERY_CAPABILITY_REQUIRED" }
  | {
      kind: "conflict";
      code: "PRINCIPAL_ALREADY_JOINED" | "MEMBER_ALREADY_LINKED";
    }
  | { kind: "not-found"; code: "HOUSEHOLD_OR_MEMBER_NOT_FOUND" };

export interface LegacyMembershipMigrationInputPort {
  captureLegacySessionCandidate(): CapturedLegacyCandidate;
  resolveSignedInUser(principalUid: string): Promise<ResolveLegacyUserResult>;
  claimLegacySession(input: {
    principalUid: string;
    candidate: LegacySessionCandidate;
    userConfirmed: true;
    idempotencyKey: string;
  }): Promise<ClaimLegacySessionResult>;
  repairLegacyMembershipClaim(
    operator: VerifiedLegacyRecoveryOperator,
    input: {
      principalUid: string;
      householdId: string;
      memberId: string;
      reason: string;
      idempotencyKey: string;
    },
  ): Promise<RepairLegacyMembershipResult>;
}
