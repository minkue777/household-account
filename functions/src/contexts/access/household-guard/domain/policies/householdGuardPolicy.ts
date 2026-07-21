import type {
  HouseholdGuardDecision,
  HouseholdGuardFacts,
} from "../model/householdGuard";

export function decideHouseholdGuard(
  input: HouseholdGuardFacts,
): HouseholdGuardDecision {
  if (input.principal === undefined) {
    return { kind: "denied", code: "AUTH_REQUIRED" };
  }
  if (!input.principal.verified) {
    return { kind: "denied", code: "UNVERIFIED_PRINCIPAL" };
  }
  if (input.principal.capabilities.includes("admin.households.read")) {
    return {
      kind: "admin-content",
      householdId: input.requestedHouseholdId,
    };
  }
  if (input.membership === undefined) {
    return input.legacyCandidate === "complete"
      ? { kind: "legacy-confirmation-required" }
      : { kind: "first-visit-required", choices: ["create", "join"] };
  }
  if (input.membership.status !== "active") {
    return { kind: "denied", code: "ACTIVE_MEMBERSHIP_REQUIRED" };
  }
  if (input.membership.householdId !== input.requestedHouseholdId) {
    return { kind: "denied", code: "HOUSEHOLD_SCOPE_MISMATCH" };
  }

  return {
    kind: "protected-content",
    actor: {
      householdId: input.membership.householdId,
      memberId: input.membership.memberId,
    },
  };
}
