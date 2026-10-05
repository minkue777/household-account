export interface RenameableHouseholdMember {
  principalUid: string;
  memberId: string;
  displayName: string;
  aggregateVersion: number;
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

