import type {
  AtomicCommandDecision,
  AtomicCommandResult,
  AtomicOutboxEvent,
  AtomicUnitOfWorkState,
} from "../../../domain/atomicCommand";

export type AtomicTransactionOutcome =
  | {
      readonly kind: "completed";
      readonly result: AtomicCommandResult;
      readonly committedEvent?: AtomicOutboxEvent;
    }
  | {
      readonly kind: "retryable-failure";
      readonly code: "UNIT_OF_WORK_COMMIT_FAILED";
    };

export interface AtomicCommandUnitOfWork {
  transact(
    decide: (state: AtomicUnitOfWorkState) => AtomicCommandDecision,
  ): Promise<AtomicTransactionOutcome>;
}

export interface AtomicEventIdGenerator {
  forCommand(commandId: string): string;
}

export interface CommittedEventDispatcher {
  dispatch(event: AtomicOutboxEvent): Promise<void>;
}
