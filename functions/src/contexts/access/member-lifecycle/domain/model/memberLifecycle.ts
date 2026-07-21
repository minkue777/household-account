export interface LifecycleHouseholdMember {
  principalUid: string;
  memberId: string;
  origin: "creator" | "invitee";
  status: "active" | "removed";
  version: number;
}

export interface LifecycleMembership {
  principalUid: string;
  householdId: string;
  memberId: string;
  status: "active" | "removed";
  version: number;
}

export interface LifecycleMemberOwnerProfile {
  profileId: string;
  linkedMemberId: string;
  lifecycleState: "active" | "archived";
}

export interface LifecyclePrincipalClaim {
  principalUid: string;
  householdId: string;
  memberId: string;
}

export interface HouseholdMemberLifecycleEvent {
  eventType: "HouseholdMemberRemoved.v1" | "HouseholdMemberRestored.v1";
  householdId: string;
  memberId: string;
  membershipVersion: number;
}

export type StoredMemberLifecycleResult =
  | {
      kind: "success";
      memberId: string;
      membershipStatus: "active" | "removed";
      membershipVersion: number;
    }
  | {
      kind: "already-processed";
      memberId: string;
      membershipVersion: number;
    };

export interface MemberLifecycleReceipt {
  idempotencyKey: string;
  payloadFingerprint: string;
  result: StoredMemberLifecycleResult;
}

export interface MemberLifecycleAggregate {
  household: {
    householdId: string;
    lifecycleState: "active";
  };
  members: readonly LifecycleHouseholdMember[];
  memberships: readonly LifecycleMembership[];
  memberOwnerProfiles: readonly LifecycleMemberOwnerProfile[];
  principalClaims: readonly LifecyclePrincipalClaim[];
  receipts: readonly MemberLifecycleReceipt[];
  events: readonly HouseholdMemberLifecycleEvent[];
}
