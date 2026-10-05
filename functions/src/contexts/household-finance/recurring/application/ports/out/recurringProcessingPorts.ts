import type {
  ProcessRecurringTargetResult,
  RecurringProcessingDecision,
  RecurringProcessingState,
  RecurringProcessPlan,
} from "../../../domain/model/recurringProcessing";

export interface RecurringFinanceUnitOfWork {
  transact(
    executionKey: string,
    decide: (state: RecurringProcessingState) => RecurringProcessingDecision,
  ): Promise<ProcessRecurringTargetResult>;
  readPlanPage(input: { readonly afterPlanId?: string; readonly limit: number }): Promise<{
    readonly plans: readonly RecurringProcessPlan[];
    readonly nextCursor?: string;
  }>;
}

export interface RecurringProcessingClock {
  now(): string;
  localDate(): string;
}

export interface RecurringProcessingIds {
  transactionId(executionKey: string): string;
  eventId(executionKey: string, eventType: string): string;
}
