import { createShortcutNotificationOutcomeApplication } from "../../src/contexts/payment-capture/shortcut-ingestion/application/shortcutNotificationOutcomeApplication";
import type {
  ShortcutNotificationOutcomeReceiptStorePort,
} from "../../src/contexts/payment-capture/shortcut-ingestion/application/ports/out/shortcutNotificationOutcomeStorePort";
import type { ShortcutCommittedSourceEventQueryPort } from "../../src/contexts/payment-capture/shortcut-ingestion/application/ports/out/shortcutCommittedSourceEventQueryPort";
import type {
  PublishShortcutNotificationOutcomeResult,
  ShortcutCommittedSourceEvent,
  ShortcutNotificationOutcomeCommit,
} from "../../src/contexts/payment-capture/shortcut-ingestion/public";

export interface ShortcutNotificationOutcomeDriverSnapshot {
  readonly sourceEvents: readonly ShortcutCommittedSourceEvent[];
  readonly consumedSourceEventIds: readonly string[];
  readonly generatedTransactionIds: readonly string[];
  readonly generatedOutboxEvents: readonly unknown[];
}

export interface ShortcutNotificationOutcomeDriver {
  consumeOutcome(input: {
    readonly requestKey: string;
    readonly sourceEventId: string;
  }): Promise<PublishShortcutNotificationOutcomeResult>;
  snapshot(): ShortcutNotificationOutcomeDriverSnapshot;
}

function cloneEvent(
  event: ShortcutCommittedSourceEvent,
): ShortcutCommittedSourceEvent {
  return { ...event };
}

class FixtureCommittedSourceEventQuery
  implements ShortcutCommittedSourceEventQueryPort
{
  private readonly events: readonly ShortcutCommittedSourceEvent[];

  constructor(events: readonly ShortcutCommittedSourceEvent[]) {
    this.events = events.map(cloneEvent);
  }

  findById(eventId: string): ShortcutCommittedSourceEvent | undefined {
    const event = this.events.find((candidate) => candidate.eventId === eventId);
    return event === undefined ? undefined : cloneEvent(event);
  }

  snapshot(): readonly ShortcutCommittedSourceEvent[] {
    return this.events.map(cloneEvent);
  }
}

class InMemoryShortcutNotificationOutcomeReceiptStore
  implements ShortcutNotificationOutcomeReceiptStorePort
{
  private readonly sourceEventIdByRequestKey = new Map<string, string>();
  private readonly consumedEventIds = new Set<string>();
  private transactionTail: Promise<void> = Promise.resolve();

  async consumeOnce(
    receipt: ShortcutNotificationOutcomeCommit,
  ): Promise<
    | { readonly kind: "consumed" }
    | { readonly kind: "already-consumed"; readonly sourceEventId: string }
  > {
    const previous = this.transactionTail;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.transactionTail = previous.then(() => gate);

    await previous;
    try {
      const priorByRequest = this.sourceEventIdByRequestKey.get(
        receipt.requestKey,
      );
      if (priorByRequest !== undefined) {
        return { kind: "already-consumed", sourceEventId: priorByRequest };
      }
      if (this.consumedEventIds.has(receipt.sourceEventId)) {
        this.sourceEventIdByRequestKey.set(
          receipt.requestKey,
          receipt.sourceEventId,
        );
        return {
          kind: "already-consumed",
          sourceEventId: receipt.sourceEventId,
        };
      }

      this.sourceEventIdByRequestKey.set(
        receipt.requestKey,
        receipt.sourceEventId,
      );
      this.consumedEventIds.add(receipt.sourceEventId);
      return { kind: "consumed" };
    } finally {
      release();
    }
  }

  consumedSourceEventIds(): readonly string[] {
    return [...this.consumedEventIds];
  }
}

export function createShortcutNotificationOutcomeDriver(fixture: {
  readonly sourceEvents: readonly ShortcutCommittedSourceEvent[];
}): ShortcutNotificationOutcomeDriver {
  const sourceEvents = new FixtureCommittedSourceEventQuery(
    fixture.sourceEvents,
  );
  const receipts = new InMemoryShortcutNotificationOutcomeReceiptStore();
  const application = createShortcutNotificationOutcomeApplication({
    sourceEvents,
    receipts,
  });
  return {
    consumeOutcome: (input) => application.consumeOutcome(input),
    snapshot: () => ({
      sourceEvents: sourceEvents.snapshot(),
      consumedSourceEventIds: receipts.consumedSourceEventIds(),
      generatedTransactionIds: [],
      generatedOutboxEvents: [],
    }),
  };
}
