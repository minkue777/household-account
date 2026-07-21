import type {
  HouseholdMemberLifecycleEvent,
  LifecycleMembership,
  MemberLifecycleAggregate,
} from "../model/memberLifecycle";

export function hasLifecycleCapability(
  capabilities: readonly string[],
  operation: "remove" | "restore",
): boolean {
  return capabilities.includes(`admin.household-members.${operation}`);
}

export function memberLifecyclePayloadFingerprint(input: {
  operation: "remove" | "restore";
  householdId: string;
  memberId: string;
  expectedMembershipVersion: number;
  reason?: string;
}): string {
  return JSON.stringify([
    input.operation,
    input.householdId,
    input.memberId,
    input.expectedMembershipVersion,
    input.reason?.trim() ?? null,
  ]);
}

export function lifecycleMembership(
  state: MemberLifecycleAggregate,
  memberId: string,
): LifecycleMembership | undefined {
  return state.memberships.find(
    (membership) =>
      membership.householdId === state.household.householdId &&
      membership.memberId === memberId,
  );
}

export function memberLifecycleEvent(input: {
  operation: "remove" | "restore";
  householdId: string;
  memberId: string;
  membershipVersion: number;
}): HouseholdMemberLifecycleEvent {
  return {
    eventType:
      input.operation === "remove"
        ? "HouseholdMemberRemoved.v1"
        : "HouseholdMemberRestored.v1",
    householdId: input.householdId,
    memberId: input.memberId,
    membershipVersion: input.membershipVersion,
  };
}
