import { OnboardingMembership } from "../model/googleOnboarding";

export const STANDARD_MEMBER_CAPABILITIES: readonly string[] = [
  "household.read",
  "household.write",
  "household.asset-owner-profile.write",
  "household.delete",
];

export type CreateSelfInputValidation =
  | { kind: "valid"; householdName: string; selfDisplayName: string }
  | {
      kind: "invalid";
      code:
        | "HOUSEHOLD_NAME_REQUIRED"
        | "SELF_DISPLAY_NAME_REQUIRED"
        | "FORBIDDEN_IDENTITY_FIELD";
    };

export type JoinSelfInputValidation =
  | { kind: "valid"; selfDisplayName: string }
  | {
      kind: "invalid";
      code: "SELF_DISPLAY_NAME_REQUIRED" | "FORBIDDEN_IDENTITY_FIELD";
    };

function hasForbiddenIdentityField(input: object): boolean {
  return (
    Object.prototype.hasOwnProperty.call(input, "principalUid") ||
    Object.prototype.hasOwnProperty.call(input, "memberId") ||
    Object.prototype.hasOwnProperty.call(input, "linkedPrincipalUid")
  );
}

export function validateCreateSelfInput(input: {
  householdName: string;
  selfDisplayName: string;
}): CreateSelfInputValidation {
  if (hasForbiddenIdentityField(input)) {
    return { kind: "invalid", code: "FORBIDDEN_IDENTITY_FIELD" };
  }
  const householdName = input.householdName.trim();
  if (householdName.length === 0) {
    return { kind: "invalid", code: "HOUSEHOLD_NAME_REQUIRED" };
  }
  const selfDisplayName = input.selfDisplayName.trim();
  if (selfDisplayName.length === 0) {
    return { kind: "invalid", code: "SELF_DISPLAY_NAME_REQUIRED" };
  }
  return { kind: "valid", householdName, selfDisplayName };
}

export function validateJoinSelfInput(input: {
  selfDisplayName: string;
}): JoinSelfInputValidation {
  if (hasForbiddenIdentityField(input)) {
    return { kind: "invalid", code: "FORBIDDEN_IDENTITY_FIELD" };
  }
  const selfDisplayName = input.selfDisplayName.trim();
  return selfDisplayName.length === 0
    ? { kind: "invalid", code: "SELF_DISPLAY_NAME_REQUIRED" }
    : { kind: "valid", selfDisplayName };
}

export function membershipView(
  membership: OnboardingMembership,
): {
  householdId: string;
  memberId: string;
  status: "active";
  capabilities: readonly string[];
} {
  return {
    householdId: membership.householdId,
    memberId: membership.memberId,
    status: "active",
    capabilities: [...membership.capabilities],
  };
}

export function invitationExpiresAt(issuedAt: string): string {
  return new Date(Date.parse(issuedAt) + 5 * 60 * 1_000).toISOString();
}

export function invitationCanBeUsed(input: {
  status: "issued" | "used";
  expiresAt: string;
  now: string;
}): boolean {
  return (
    input.status === "issued" && Date.parse(input.now) < Date.parse(input.expiresAt)
  );
}
