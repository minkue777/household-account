import type {
  ActiveAccessMembership,
  PrincipalMembershipClaim,
} from "../../../membership/domain/model/accessMembership";

export interface OnboardingHousehold {
  householdId: string;
  name: string;
  lifecycleState: "active";
}

export interface OnboardingMember {
  householdId: string;
  memberId: string;
  linkedPrincipalUid: string;
  displayName: string;
}

export interface OnboardingMembership extends ActiveAccessMembership {
  capabilities: readonly string[];
}

export interface HouseholdInitialization {
  householdId: string;
  status: "pending" | "completed" | "failed";
}

export interface HouseholdInvitation {
  invitationHash: string;
  householdId: string;
  expiresAt: string;
  status: "issued" | "used";
  usedByUid?: string;
}

export interface OnboardingAccessEvent {
  eventType: string;
  householdId: string;
  payload: Readonly<Record<string, unknown>>;
}

export interface GoogleOnboardingState {
  households: readonly OnboardingHousehold[];
  members: readonly OnboardingMember[];
  memberships: readonly OnboardingMembership[];
  principalClaims: readonly PrincipalMembershipClaim[];
  initializations: readonly HouseholdInitialization[];
  invitations: readonly HouseholdInvitation[];
  events: readonly OnboardingAccessEvent[];
}
