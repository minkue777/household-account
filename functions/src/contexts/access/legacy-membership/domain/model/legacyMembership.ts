import type { ActiveAccessMembership } from "../../../membership/domain/model/accessMembership";

export interface LegacyHousehold {
  householdId: string;
  legacyHouseholdKey: string;
  lifecycleState: "active" | "deleted";
}

export interface LegacyCandidateValue {
  householdKey: string;
  currentMemberId: string;
  currentMemberName?: string;
}

export interface LegacyMember {
  householdId: string;
  memberId: string;
  displayName: string;
  linkedPrincipalUid?: string;
}

export type LegacyMembership = ActiveAccessMembership;

export interface LegacyMemberOwnerProfile {
  householdId: string;
  profileId: string;
  linkedMemberId: string;
  lifecycleState: "active";
}

export interface LegacyClaimAuditEvent {
  eventType: string;
  householdId: string;
  memberId: string;
}

export interface LegacyMembershipState {
  households: readonly LegacyHousehold[];
  members: readonly LegacyMember[];
  memberships: readonly LegacyMembership[];
  memberOwnerProfiles: readonly LegacyMemberOwnerProfile[];
  auditEvents: readonly LegacyClaimAuditEvent[];
}
