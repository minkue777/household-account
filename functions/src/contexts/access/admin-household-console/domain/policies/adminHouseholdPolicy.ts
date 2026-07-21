import { AdminHousehold } from "../model/adminHousehold";

export type HouseholdNameValidation =
  | { kind: "valid"; name: string }
  | { kind: "invalid"; code: "HOUSEHOLD_NAME_REQUIRED" };

export function validateHouseholdName(name: string): HouseholdNameValidation {
  const normalized = name.trim();
  return normalized.length === 0
    ? { kind: "invalid", code: "HOUSEHOLD_NAME_REQUIRED" }
    : { kind: "valid", name: normalized };
}

export function sortHouseholdsForAdmin(
  households: readonly AdminHousehold[],
): readonly AdminHousehold[] {
  return households.slice().sort((left, right) => {
    const byCreatedAt = right.createdAt.localeCompare(left.createdAt);
    return byCreatedAt !== 0
      ? byCreatedAt
      : left.householdId.localeCompare(right.householdId);
  });
}

export type DeleteHouseholdDecision =
  | { kind: "success"; household: AdminHousehold }
  | { kind: "validation-error"; code: string };

export function deleteHouseholdLogically(input: {
  household: AdminHousehold | undefined;
  confirmed: boolean;
  expectedVersion: number;
}): DeleteHouseholdDecision {
  if (!input.confirmed) {
    return {
      kind: "validation-error",
      code: "DELETION_CONFIRMATION_REQUIRED",
    };
  }
  if (input.household === undefined) {
    return { kind: "validation-error", code: "HOUSEHOLD_NOT_FOUND" };
  }
  if (input.household.aggregateVersion !== input.expectedVersion) {
    return {
      kind: "validation-error",
      code: "HOUSEHOLD_VERSION_MISMATCH",
    };
  }
  if (input.household.lifecycleState === "deleted") {
    return { kind: "success", household: input.household };
  }
  return {
    kind: "success",
    household: {
      ...input.household,
      lifecycleState: "deleted",
      aggregateVersion: input.household.aggregateVersion + 1,
    },
  };
}
