import type {
  ScopedValuationTarget,
  ValuationHousehold,
} from "../model/assetValuationTriggerScope";

function activeHouseholdIds(
  households: readonly ValuationHousehold[],
): Set<string> {
  return new Set(
    households
      .filter(({ lifecycle }) => lifecycle === "active")
      .map(({ householdId }) => householdId),
  );
}

export function selectDailyValuationTargets(input: {
  households: readonly ValuationHousehold[];
  targets: readonly ScopedValuationTarget[];
}): readonly ScopedValuationTarget[] {
  const active = activeHouseholdIds(input.households);
  return input.targets.filter(
    ({ householdId, assetLifecycle }) =>
      active.has(householdId) && assetLifecycle === "active",
  );
}

export function selectHouseholdValuationTargets(input: {
  householdId: string;
  households: readonly ValuationHousehold[];
  targets: readonly ScopedValuationTarget[];
}): readonly ScopedValuationTarget[] {
  const active = activeHouseholdIds(input.households);
  if (!active.has(input.householdId)) return [];
  return input.targets.filter(
    ({ householdId, assetLifecycle }) =>
      householdId === input.householdId && assetLifecycle === "active",
  );
}
