export interface RecurringPlanView {
  householdId: string;
  planId: string;
  merchant: string;
  amountInWon: number;
  categoryId: string;
  dayOfMonth: number;
  memo: string;
  active: boolean;
  creatorMemberId: string;
  firstApplicableMonth: string;
  createdAt: string;
  updatedAt: string;
  lifecycleState: "active" | "deleted";
  version: number;
}

export type RecurringCapability = "recurring.manage" | "recurring.read";

export interface RecurringActor {
  householdId: string;
  actingMemberId: string;
  capabilities: readonly RecurringCapability[];
}

export type ManageRecurringPlanOperation =
  | {
      kind: "create";
      merchant: string;
      amountInWon: number;
      categoryId: string;
      dayOfMonth: number;
      memo?: string;
      active: boolean;
    }
  | {
      kind: "update";
      planId: string;
      expectedVersion: number;
      patch: Partial<
        Pick<
          RecurringPlanView,
          | "merchant"
          | "amountInWon"
          | "categoryId"
          | "dayOfMonth"
          | "memo"
          | "active"
        >
      >;
    }
  | { kind: "delete"; planId: string; expectedVersion: number };

export type ManageRecurringPlanResult =
  | { kind: "success"; plan: RecurringPlanView }
  | { kind: "deleted"; planId: string; version: number }
  | { kind: "already-processed"; plan: RecurringPlanView }
  | { kind: "validation-error"; code: string }
  | { kind: "not-found"; code: "PLAN_NOT_FOUND" }
  | { kind: "conflict"; code: string; currentVersion?: number }
  | {
      kind: "forbidden";
      code: "CAPABILITY_REQUIRED" | "HOUSEHOLD_SCOPE_REQUIRED";
    }
  | { kind: "retryable-failure"; code: string };

export type RecurringPlanListResult =
  | {
      kind: "success";
      items: readonly RecurringPlanView[];
      nextCursor?: string;
      sourceCheckpoint: string;
    }
  | { kind: "no-data" }
  | {
      kind: "forbidden";
      code: "CAPABILITY_REQUIRED" | "HOUSEHOLD_SCOPE_REQUIRED";
    }
  | { kind: "validation-error"; code: string }
  | { kind: "retryable-failure"; code: string };

export interface RecurringPlanManagementInputPort {
  manage(input: {
    commandId: string;
    actor: RecurringActor;
    operation: ManageRecurringPlanOperation;
  }): Promise<ManageRecurringPlanResult>;
  list(input: {
    actor: RecurringActor;
    householdId: string;
    active?: boolean;
    cursor?: string;
    limit: number;
  }): Promise<RecurringPlanListResult>;
}
