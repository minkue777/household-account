import type {
  HouseholdLifecycleRecord,
  HouseholdLifecycleView,
} from "../model/householdLifecycle";

export function hasHouseholdLifecycleCapability(
  capabilities: readonly string[],
  capability:
    | "household.delete"
    | "household.restore"
    | "household.purge.permanent",
): boolean {
  return capabilities.includes(capability);
}

export function toHouseholdLifecycleView(
  record: HouseholdLifecycleRecord,
): HouseholdLifecycleView {
  return {
    householdId: record.householdId,
    lifecycleState: record.lifecycleState,
    aggregateVersion: record.aggregateVersion,
    ...(record.deletedAt === undefined ? {} : { deletedAt: record.deletedAt }),
  };
}

export function householdLifecyclePayloadFingerprint(input: {
  operation: "delete" | "restore" | "request-permanent-purge";
  householdId: string;
  expectedVersion: number;
  reason?: string;
  confirmation?: string;
}): string {
  return JSON.stringify([
    input.operation,
    input.householdId,
    input.expectedVersion,
    input.reason?.trim() ?? null,
    input.confirmation?.trim() ?? null,
  ]);
}
