import { createShortcutOutboxResponseApplication } from "../../src/contexts/payment-capture/shortcut-ingestion/application/shortcutOutboxResponseApplication";
import type { ShortcutCommittedSourceEventQueryPort } from "../../src/contexts/payment-capture/shortcut-ingestion/application/ports/out/shortcutCommittedSourceEventQueryPort";
import type { ShortcutOutboxResponseStorePort } from "../../src/contexts/payment-capture/shortcut-ingestion/application/ports/out/shortcutOutboxResponseStorePort";
import {
  mapLegacyShortcutPaymentResponse,
  type LegacyShortcutPaymentResponse,
} from "../../src/contexts/payment-capture/shortcut-ingestion/adapters/outbound/legacyShortcutResponseMapper";
import type {
  ShortcutCommittedSourceEvent,
  ShortcutLedgerResult,
  ShortcutPaymentResultV2,
} from "../../src/contexts/payment-capture/shortcut-ingestion/public";

export interface ShortcutOutboxResponseDriverState {
  readonly sourceEvents: readonly ShortcutCommittedSourceEvent[];
  readonly consumedSourceEventIds: readonly string[];
  readonly generatedOutboxEvents: readonly unknown[];
  readonly generatedTransactionIds: readonly string[];
  readonly domainResults: readonly ShortcutPaymentResultV2[];
  readonly legacyPayloadsAtDomainBoundary: readonly unknown[];
}

export interface ShortcutOutboxResponseDriver {
  publish(input: {
    readonly commandId: string;
    readonly ledgerResult: ShortcutLedgerResult;
    readonly sourceEventId?: string;
  }): ShortcutPaymentResultV2;
  mapLegacyOutbound(
    result: ShortcutPaymentResultV2,
  ): LegacyShortcutPaymentResponse;
  state(): ShortcutOutboxResponseDriverState;
}

function cloneResult(result: ShortcutPaymentResultV2): ShortcutPaymentResultV2 {
  return {
    ...result,
    transaction: { ...result.transaction },
    notification: { ...result.notification },
  };
}

function cloneEvent(
  event: ShortcutCommittedSourceEvent,
): ShortcutCommittedSourceEvent {
  return { ...event };
}

class FixtureShortcutSourceEventQuery
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

class InMemoryShortcutOutboxResponseStore
  implements ShortcutOutboxResponseStorePort
{
  private readonly resultsByCommandId = new Map<
    string,
    ShortcutPaymentResultV2
  >();
  private readonly consumedEventIds = new Set<string>();

  findByCommandId(commandId: string): ShortcutPaymentResultV2 | undefined {
    const result = this.resultsByCommandId.get(commandId);
    return result === undefined ? undefined : cloneResult(result);
  }

  commitOnce(
    input: Parameters<ShortcutOutboxResponseStorePort["commitOnce"]>[0],
  ): ReturnType<ShortcutOutboxResponseStorePort["commitOnce"]> {
    const existing = this.resultsByCommandId.get(input.commandId);
    if (existing !== undefined) {
      return { kind: "AlreadyCommitted", result: cloneResult(existing) };
    }

    this.resultsByCommandId.set(input.commandId, cloneResult(input.result));
    if (input.consumedSourceEventId !== undefined) {
      this.consumedEventIds.add(input.consumedSourceEventId);
    }
    return { kind: "Committed" };
  }

  state(sourceEvents: readonly ShortcutCommittedSourceEvent[]): ShortcutOutboxResponseDriverState {
    return {
      sourceEvents: sourceEvents.map(cloneEvent),
      consumedSourceEventIds: [...this.consumedEventIds],
      generatedOutboxEvents: [],
      generatedTransactionIds: [],
      domainResults: [...this.resultsByCommandId.values()].map(cloneResult),
      legacyPayloadsAtDomainBoundary: [],
    };
  }
}

export function createShortcutOutboxResponseDriver(
  fixture: { readonly sourceEvents?: readonly ShortcutCommittedSourceEvent[] } = {},
): ShortcutOutboxResponseDriver {
  const sourceEvents = new FixtureShortcutSourceEventQuery(
    fixture.sourceEvents ?? [],
  );
  const store = new InMemoryShortcutOutboxResponseStore();
  const application = createShortcutOutboxResponseApplication({
    store,
    sourceEvents,
  });

  return {
    publish: (input) => cloneResult(application.publish(input)),
    mapLegacyOutbound: (result) => mapLegacyShortcutPaymentResponse(result),
    state: () => store.state(sourceEvents.snapshot()),
  };
}
