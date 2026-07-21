export type AccessMembershipStatus = "active" | "removed";

export interface AccessMembership {
  principalUid: string;
  householdId: string;
  memberId: string;
  status: AccessMembershipStatus;
}

export interface ActiveAccessMembership extends AccessMembership {
  status: "active";
}

export interface PrincipalMembershipClaim {
  principalUid: string;
  householdId: string;
  memberId: string;
  version: number;
}

export function findActiveMembership<TMembership extends AccessMembership>(
  memberships: readonly TMembership[],
  principalUid: string,
): (TMembership & ActiveAccessMembership) | undefined {
  return memberships.find(
    (candidate): candidate is TMembership & ActiveAccessMembership =>
      candidate.principalUid === principalUid && candidate.status === "active",
  );
}
