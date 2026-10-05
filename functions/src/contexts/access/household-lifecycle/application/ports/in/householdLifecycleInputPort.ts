import type {
  HouseholdLifecycleEvent,
  HouseholdLifecycleView,
} from "../../../domain/model/householdLifecycle";

export type { HouseholdLifecycleEvent, HouseholdLifecycleView };

export interface VerifiedAdministrativeActor {
  principalRef: string;
  capabilities: readonly (
    | "household.delete"
    | "household.restore"
    | "household.purge.permanent"
    | "household.purge.read"
  )[];
}

export interface RestoreDeletedHouseholdCommand {
  householdId: string;
  reason: string;
  expectedVersion: number;
  idempotencyKey: string;
}

export type HouseholdLifecycleCommandResult =
  | { kind: "success"; household: HouseholdLifecycleView; processId?: string }
  | {
      kind: "already-processed";
      household: HouseholdLifecycleView;
      processId?: string;
    }
  | { kind: "conflict"; code: string; currentVersion?: number }
  | { kind: "forbidden"; code: string };

export interface HouseholdLifecycleInputPort {
  restoreDeletedHousehold(
    actor: VerifiedAdministrativeActor,
    input: RestoreDeletedHouseholdCommand,
  ): Promise<HouseholdLifecycleCommandResult>;
}
