import {
  LegacyCandidateValue,
  LegacyHousehold,
  LegacyMember,
  LegacyMembershipState,
} from "../model/legacyMembership";

export function captureLegacyCandidate(
  webLocalStorage: Readonly<Record<string, string>>,
):
  | { kind: "complete"; candidate: LegacyCandidateValue }
  | { kind: "absent" } {
  const householdKey = webLocalStorage.householdKey?.trim();
  const currentMemberId = webLocalStorage.currentMemberId?.trim();
  if (!householdKey || !currentMemberId) {
    return { kind: "absent" };
  }
  const currentMemberName = webLocalStorage.currentMemberName?.trim();
  return {
    kind: "complete",
    candidate: {
      householdKey,
      currentMemberId,
      ...(currentMemberName ? { currentMemberName } : {}),
    },
  };
}

export interface LegacyCandidateTarget {
  household: LegacyHousehold;
  member: LegacyMember;
}

export function resolveLegacyCandidateTarget(
  state: LegacyMembershipState,
  candidate: LegacyCandidateValue,
): LegacyCandidateTarget | undefined {
  const household = state.households.find(
    (item) =>
      item.legacyHouseholdKey === candidate.householdKey &&
      item.lifecycleState === "active",
  );
  if (household === undefined) {
    return undefined;
  }
  const member = state.members.find(
    (item) =>
      item.householdId === household.householdId &&
      item.memberId === candidate.currentMemberId,
  );
  return member === undefined ? undefined : { household, member };
}
