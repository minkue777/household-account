export interface GuardPrincipalFact {
  principalRef: string;
  verified: boolean;
  capabilities: readonly string[];
}

export interface GuardMembershipFact {
  householdId: string;
  memberId: string;
  status: "active" | "removed";
}

export interface HouseholdGuardFacts {
  principal?: GuardPrincipalFact;
  requestedHouseholdId: string;
  membership?: GuardMembershipFact;
  legacyCandidate: "complete" | "absent";
  /** 호환 입력일 뿐 인증·인가 판정에는 절대 사용하지 않습니다. */
  presentedLegacyKey?: string;
}

export type HouseholdGuardDecision =
  | {
      kind: "protected-content";
      actor: { householdId: string; memberId: string };
    }
  | { kind: "admin-content"; householdId: string }
  | { kind: "legacy-confirmation-required" }
  | { kind: "first-visit-required"; choices: readonly ["create", "join"] }
  | {
      kind: "denied";
      code:
        | "AUTH_REQUIRED"
        | "UNVERIFIED_PRINCIPAL"
        | "ACTIVE_MEMBERSHIP_REQUIRED"
        | "HOUSEHOLD_SCOPE_MISMATCH";
    };
