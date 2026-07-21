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

export interface RequestHouseholdDeletionCommand {
  householdId: string;
  reason: string;
  expectedVersion: number;
  idempotencyKey: string;
}

export interface RestoreDeletedHouseholdCommand {
  householdId: string;
  reason: string;
  expectedVersion: number;
  idempotencyKey: string;
}

export interface RequestPermanentHouseholdPurgeCommand {
  householdId: string;
  confirmation: string;
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

export type BusinessAccessResult =
  | { kind: "allowed"; householdId: string }
  | { kind: "conflict"; code: "HOUSEHOLD_NOT_ACTIVE" };

export interface HouseholdLifecycleInputPort {
  requestHouseholdDeletion(
    actor: VerifiedAdministrativeActor,
    input: RequestHouseholdDeletionCommand,
  ): Promise<HouseholdLifecycleCommandResult>;
  restoreDeletedHousehold(
    actor: VerifiedAdministrativeActor,
    input: RestoreDeletedHouseholdCommand,
  ): Promise<HouseholdLifecycleCommandResult>;
  requestPermanentHouseholdPurge(
    actor: VerifiedAdministrativeActor,
    input: RequestPermanentHouseholdPurgeCommand,
  ): Promise<HouseholdLifecycleCommandResult>;
  authorizeBusinessAccess(householdId: string): Promise<BusinessAccessResult>;
}
