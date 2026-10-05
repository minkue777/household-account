import type { CreatorMappedRecurringPlan, RecurringPlan, RecurringPlanChangedEvent, RecurringPlanCommandReceipt } from "../../../domain/model/recurringPlan";

export interface RecurringPlanMutation<T> {
  value: T;
  change?: { plan: CreatorMappedRecurringPlan; receipt: RecurringPlanCommandReceipt; event: RecurringPlanChangedEvent };
}

export interface RecurringPlanCommandSnapshot {
  plan?: RecurringPlan;
  receipt?: RecurringPlanCommandReceipt;
  categoryIsUsable(categoryId: string): Promise<boolean>;
}

export type RecurringPlanListRead =
  | { kind: "success"; plans: readonly RecurringPlan[] }
  | { kind: "retryable-failure"; code: "RECURRING_PLAN_REPOSITORY_UNAVAILABLE" };

export interface RecurringPlanManagementStorePort {
  readForList(): Promise<RecurringPlanListRead>;
  transact<T>(
    planId: string,
    commandId: string,
    operation: (current: RecurringPlanCommandSnapshot) => Promise<RecurringPlanMutation<T>>,
  ): Promise<T>;
}

export interface RecurringPlanClockPort {
  now(): string;
  localDate(): string;
}

export interface RecurringPlanIdentityPort {
  planId(commandId: string): string;
}
