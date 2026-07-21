import { createAtomicCommandApplication } from "../../src/platform/unit-of-work/application/atomicCommandApplication";
import type {
  AtomicCommandUnitOfWork,
  AtomicTransactionOutcome,
} from "../../src/platform/unit-of-work/application/ports/out/atomicCommandPorts";
import type {
  AtomicCommandDecision,
  AtomicOutboxEvent,
  AtomicUnitOfWorkState,
} from "../../src/platform/unit-of-work/domain/atomicCommand";
import type {
  AtomicCommandInput,
  AtomicCommandResult,
} from "../../src/platform/unit-of-work/public";

export interface UnitOfWorkStateView {
  readonly records: readonly { recordId: string; value: string }[];
  readonly receipts: readonly { commandId: string; result: string }[];
  readonly outboxEvents: readonly { eventId: string; type: string }[];
}

export interface UnitOfWorkIntegrityFixtureSubject {
  execute(input: AtomicCommandInput): Promise<AtomicCommandResult>;
  state(): UnitOfWorkStateView;
  dispatchedEventIds(): readonly string[];
}

function emptyState(): AtomicUnitOfWorkState {
  return { records: [], receipts: [], outboxEvents: [] };
}

class RetryingAtomicUnitOfWork implements AtomicCommandUnitOfWork {
  private current = emptyState();

  constructor(
    private readonly callbackAttemptsBeforeCommit: number,
    private readonly failAt?: "record" | "receipt" | "outbox",
  ) {}

  async transact(
    decide: (state: AtomicUnitOfWorkState) => AtomicCommandDecision,
  ): Promise<AtomicTransactionOutcome> {
    let decision!: AtomicCommandDecision;
    const attempts = Math.max(1, this.callbackAttemptsBeforeCommit);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      decision = decide(structuredClone(this.current));
    }
    if (decision.kind === "return") {
      return { kind: "completed", result: structuredClone(decision.result) };
    }
    if (this.failAt !== undefined) {
      return {
        kind: "retryable-failure",
        code: "UNIT_OF_WORK_COMMIT_FAILED",
      };
    }
    this.current = structuredClone(decision.nextState);
    return {
      kind: "completed",
      result: structuredClone(decision.result),
      committedEvent: { ...decision.event },
    };
  }

  snapshot(): AtomicUnitOfWorkState {
    return structuredClone(this.current);
  }
}

export function createUnitOfWorkIntegrityFixture(fixture: {
  callbackAttemptsBeforeCommit?: number;
  failAt?: "record" | "receipt" | "outbox";
}): UnitOfWorkIntegrityFixtureSubject {
  const store = new RetryingAtomicUnitOfWork(
    fixture.callbackAttemptsBeforeCommit ?? 1,
    fixture.failAt,
  );
  const dispatched: AtomicOutboxEvent[] = [];
  const application = createAtomicCommandApplication({
    unitOfWork: store,
    eventIds: { forCommand: (commandId) => `event:${commandId}` },
    dispatcher: {
      async dispatch(event) {
        dispatched.push({ ...event });
      },
    },
  });

  return {
    execute: (input) => application.execute(input),
    state() {
      const state = store.snapshot();
      return {
        records: state.records.map((record) => ({ ...record })),
        receipts: state.receipts.map(({ payloadFingerprint: _hash, ...receipt }) => ({
          ...receipt,
        })),
        outboxEvents: state.outboxEvents.map((event) => ({ ...event })),
      };
    },
    dispatchedEventIds: () => dispatched.map((event) => event.eventId),
  };
}
