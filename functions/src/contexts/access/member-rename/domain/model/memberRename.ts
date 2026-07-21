export interface RenameableHouseholdMember {
  principalUid: string;
  memberId: string;
  displayName: string;
  aggregateVersion: number;
}

export interface MemberRenameMembership {
  principalUid: string;
  memberId: string;
  status: "active" | "removed";
}

export interface LinkedMemberOwnerProfile {
  profileId: string;
  linkedMemberId: string;
  displayName: string;
}

export interface MemberRenamedEvent {
  eventType: "MemberRenamed.v1";
  householdId: string;
  memberId: string;
  newDisplayName: string;
}

export interface MemberRenameReceipt {
  idempotencyKey: string;
  payloadFingerprint: string;
  result: {
    kind: "success";
    member: {
      memberId: string;
      displayName: string;
      aggregateVersion: number;
    };
  };
}

export interface MemberRenameState {
  householdId: string;
  members: readonly RenameableHouseholdMember[];
  memberships: readonly MemberRenameMembership[];
  memberOwnerProfiles: readonly LinkedMemberOwnerProfile[];
  receipts: readonly MemberRenameReceipt[];
  events: readonly MemberRenamedEvent[];
}
