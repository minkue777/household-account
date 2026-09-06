import type {
  ProcessRecurringTargetResult,
  RecurringProcessingDecision,
  RecurringProcessingEvent,
  RecurringProcessingState,
  RecurringProcessPlan,
} from "../../../domain/model/recurringProcessing";

export type RecurringCommitFailure =
  | "transaction-save"
  | "execution-checkpoint-save"
  | "receipt-save";

export interface RecurringFinanceUnitOfWork {
  transact(
    executionKey: string,
    decide: (state: RecurringProcessingState) => RecurringProcessingDecision,
  ): Promise<{
    result: ProcessRecurringTargetResult;
    committedEvents: readonly RecurringProcessingEvent[];
  }>;
  read(): Promise<RecurringProcessingState>;
  readPlanPage?(input: { readonly afterPlanId?: string; readonly limit: number }): Promise<{
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

export interface RecurringProcessingEventPublisher {
  publish(events: readonly RecurringProcessingEvent[]): Promise<void>;
}
