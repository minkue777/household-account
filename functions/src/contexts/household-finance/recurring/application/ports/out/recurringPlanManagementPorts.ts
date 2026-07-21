import type {
  RecurringPlanCommandReceipt,
  RecurringPlanManagementState,
} from "../../../domain/model/recurringPlan";

export interface RecurringPlanMutation<T> {
  state: RecurringPlanManagementState;
  value: T;
}

export type RecurringPlanListRead =
  | { kind: "success"; state: RecurringPlanManagementState }
  | {
      kind: "retryable-failure";
      code: "RECURRING_PLAN_REPOSITORY_UNAVAILABLE";
    };

export interface RecurringPlanManagementStorePort {
  read(): Promise<RecurringPlanManagementState>;
  readReceipt(commandId: string): Promise<RecurringPlanCommandReceipt | undefined>;
  readForList(): Promise<RecurringPlanListRead>;
  transact<T>(
    operation: (
      current: RecurringPlanManagementState,
    ) => RecurringPlanMutation<T>,
  ): Promise<T>;
}

export interface RecurringPlanClockPort {
  now(): string;
  localDate(): string;
}

export interface RecurringPlanIdentityPort {
  planId(commandId: string): string;
}

export type RecurringCategoryReferenceResult =
  | { kind: "usable" }
  | { kind: "not-usable" }
  | { kind: "retryable-failure"; code: string };

export interface RecurringCategoryReferencePort {
  resolveUsableCategory(
    householdId: string,
    categoryId: string,
  ): Promise<RecurringCategoryReferenceResult>;
}
