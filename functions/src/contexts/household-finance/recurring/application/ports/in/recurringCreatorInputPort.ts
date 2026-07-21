import type { RecurringPlanView } from "./recurringPlanManagementInputPort";

export interface RecurringMigrationActor {
  actorId: string;
  capabilities: readonly "recurring.migrate"[];
}

export interface RecurringProcessSystemActor {
  actorId: string;
  capabilities: readonly "recurring.process"[];
}

export interface RecurringCreatedTransactionView {
  transactionId: string;
  planId: string;
  creatorMemberId: string;
  source: "recurring";
}

export type MapLegacyRecurringCreatorResult =
  | { kind: "success"; plan: RecurringPlanView }
  | { kind: "already-processed"; plan: RecurringPlanView }
  | { kind: "validation-error"; code: "CREATOR_MEMBER_NOT_IN_HOUSEHOLD" }
  | { kind: "not-found"; code: "PLAN_NOT_FOUND" }
  | {
      kind: "forbidden";
      code: "CAPABILITY_REQUIRED" | "HOUSEHOLD_SCOPE_REQUIRED";
    }
  | {
      kind: "conflict";
      code:
        | "PLAN_VERSION_MISMATCH"
        | "CREATOR_ALREADY_ASSIGNED"
        | "IDEMPOTENCY_PAYLOAD_MISMATCH";
      currentVersion?: number;
    };

export type ProcessRecurringCreatorResult =
  | { kind: "created"; transaction: RecurringCreatedTransactionView }
  | { kind: "already-processed"; transaction: RecurringCreatedTransactionView }
  | { kind: "not-found"; code: "PLAN_NOT_FOUND" }
  | {
      kind: "forbidden";
      code: "CAPABILITY_REQUIRED" | "HOUSEHOLD_SCOPE_REQUIRED";
    }
  | {
      kind: "conflict";
      code: "LEGACY_CREATOR_MAPPING_REQUIRED";
    };

export interface RecurringCreatorInputPort {
  mapLegacyCreator(
    actor: RecurringMigrationActor,
    input: {
      commandId: string;
      householdId: string;
      planId: string;
      creatorMemberId: string;
      expectedVersion: number;
    },
  ): Promise<MapLegacyRecurringCreatorResult>;
  processRecurringMonthWithCreator(
    actor: RecurringProcessSystemActor,
    input: {
      householdId: string;
      planId: string;
      targetMonth: string;
    },
  ): Promise<ProcessRecurringCreatorResult>;
}
