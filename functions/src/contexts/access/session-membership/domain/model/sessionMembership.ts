export interface SessionHousehold {
  householdId: string;
  lifecycleState: "active" | "deleted";
}

export interface SessionMember {
  memberId: string;
  displayName: string;
  status: "active";
}

export interface RetainedMembership {
  principalUid: string;
  householdId: string;
  memberId: string;
  status: "active";
}

export interface ClientSessionScope {
  schemaVersion: "session-scope.v1";
  sessionGeneration: number;
  principalUid: string;
  householdId: string;
  actingMemberId: string;
  displayName: string;
}

export interface NativeSessionMirror {
  householdId: string;
  memberId: string;
  sessionGeneration: number;
}

export interface SessionMembershipState {
  household: SessionHousehold;
  member: SessionMember;
  membership: RetainedMembership;
  session?: ClientSessionScope;
  bridgeMirror?: NativeSessionMirror;
  lastSessionGeneration: number;
  notificationSync: "not-requested" | "registered" | "retryable-failure";
}
