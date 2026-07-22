import { createShortcutTransactionNotificationConsumer } from "../../src/contexts/notifications/application/shortcutTransactionNotificationConsumer";
import type {
  ShortcutDeliveryRecord,
  ShortcutNotificationFacts,
  ShortcutNotificationFactsQuery,
  ShortcutProviderOutcome,
  ShortcutTransactionNotificationProvider,
  ShortcutTransactionNotificationStore,
} from "../../src/contexts/notifications/application/ports/outbound/shortcutTransactionNotificationPorts";
import {
  createNotificationTargetPlanner,
  type ShortcutTransactionNotificationInputPort,
} from "../../src/contexts/notifications/public";
import type { NotificationTarget } from "../../src/contexts/notifications/domain/model/notificationTarget";

export interface ShortcutCreatorEndpoint {
  endpointId: string;
  householdId: string;
  memberId: string;
  platform: "ios-pwa";
  status: "active";
  fid: string;
}

export interface ShortcutTransactionConsumerFixture {
  sourceLedgerDigest: string;
  creatorEndpoint: ShortcutCreatorEndpoint;
  providerOutcome: ShortcutProviderOutcome;
}

export interface ShortcutTransactionNotificationSnapshot {
  sourceLedgerDigest: string;
  inboxEventIds: readonly string[];
  deliveries: readonly {
    eventId: string;
    endpointId: string;
    status: ShortcutProviderOutcome;
  }[];
}

export interface ShortcutProviderSendCall {
  eventId: string;
  endpointId: string;
  fid: string;
  payload: NotificationTarget["payload"];
  operation: "sendOne";
}

export interface ShortcutTransactionConsumerFixtureSubject
  extends ShortcutTransactionNotificationInputPort {
  providerSendCalls(): readonly ShortcutProviderSendCall[];
  snapshot(): ShortcutTransactionNotificationSnapshot;
}

class FixtureShortcutNotificationFactsQuery
  implements ShortcutNotificationFactsQuery
{
  constructor(private readonly endpoint: ShortcutCreatorEndpoint) {}

  async load(householdId: string): Promise<ShortcutNotificationFacts> {
    const endpoint = this.endpoint;
    return {
      members:
        endpoint.householdId === householdId
          ? [
              {
                householdId: endpoint.householdId,
                memberId: endpoint.memberId,
                status: "active",
              },
            ]
          : [],
      endpoints:
        endpoint.householdId === householdId
          ? [
              {
                ...endpoint,
                registrationVersion: 1,
                bindingVersion: 1,
                deviceInfo: {},
                registeredAt: "2026-07-19T00:00:00.000Z",
                lastConfirmedAt: "2026-07-19T00:00:00.000Z",
              },
            ]
          : [],
    };
  }
}

interface InboxRecord {
  status: "processing" | "completed";
  outcome?: ShortcutProviderOutcome;
}

interface CompletionWaiter {
  promise: Promise<ShortcutProviderOutcome>;
  resolve: (outcome: ShortcutProviderOutcome) => void;
}

function cloneDelivery(record: ShortcutDeliveryRecord): ShortcutDeliveryRecord {
  return { ...record, payload: { ...record.payload } };
}

class FixtureShortcutTransactionNotificationStore
  implements ShortcutTransactionNotificationStore
{
  private readonly inbox = new Map<string, InboxRecord>();
  private readonly deliveries = new Map<string, ShortcutDeliveryRecord>();
  private readonly waiters = new Map<string, CompletionWaiter>();
  private transactionTail: Promise<void> = Promise.resolve();

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.transactionTail;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.transactionTail = previous.then(() => gate);

    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async claimEvent(input: {
    eventId: string;
    transactionId: string;
    deliveries: readonly ShortcutDeliveryRecord[];
  }): Promise<
    | { kind: "claimed"; deliveries: readonly ShortcutDeliveryRecord[] }
    | { kind: "in-progress" }
    | { kind: "completed"; outcome: ShortcutProviderOutcome }
  > {
    return this.exclusive(async () => {
      const existing = this.inbox.get(input.eventId);
      if (existing?.status === "completed" && existing.outcome !== undefined) {
        return { kind: "completed", outcome: existing.outcome };
      }
      if (existing?.status === "processing") {
        return { kind: "in-progress" };
      }

      this.inbox.set(input.eventId, { status: "processing" });
      for (const delivery of input.deliveries) {
        this.deliveries.set(
          `${delivery.eventId}\u0000${delivery.endpointId}`,
          cloneDelivery(delivery),
        );
      }
      this.ensureWaiter(input.eventId);
      return {
        kind: "claimed",
        deliveries: input.deliveries.map(cloneDelivery),
      };
    });
  }

  async completeEvent(input: {
    eventId: string;
    outcome: ShortcutProviderOutcome;
    deliveries: readonly ShortcutDeliveryRecord[];
  }): Promise<void> {
    await this.exclusive(async () => {
      for (const delivery of input.deliveries) {
        this.deliveries.set(
          `${delivery.eventId}\u0000${delivery.endpointId}`,
          cloneDelivery(delivery),
        );
      }
      this.inbox.set(input.eventId, {
        status: "completed",
        outcome: input.outcome,
      });
      this.waiters.get(input.eventId)?.resolve(input.outcome);
      this.waiters.delete(input.eventId);
    });
  }

  async waitForCompletion(eventId: string): Promise<ShortcutProviderOutcome> {
    const existing = this.inbox.get(eventId);
    if (existing?.status === "completed" && existing.outcome !== undefined) {
      return existing.outcome;
    }
    if (existing?.status !== "processing") {
      throw new Error(`Shortcut event is not in progress: ${eventId}`);
    }
    return this.ensureWaiter(eventId).promise;
  }

  snapshot(
    sourceLedgerDigest: string,
  ): ShortcutTransactionNotificationSnapshot {
    return {
      sourceLedgerDigest,
      inboxEventIds: [...this.inbox.keys()].sort(),
      deliveries: [...this.deliveries.values()]
        .filter(
          (
            delivery,
          ): delivery is ShortcutDeliveryRecord & {
            status: ShortcutProviderOutcome;
          } => delivery.status !== "queued",
        )
        .sort((left, right) =>
          left.eventId === right.eventId
            ? left.endpointId.localeCompare(right.endpointId)
            : left.eventId.localeCompare(right.eventId),
        )
        .map((delivery) => ({
          eventId: delivery.eventId,
          endpointId: delivery.endpointId,
          status: delivery.status,
        })),
    };
  }

  private ensureWaiter(eventId: string): CompletionWaiter {
    const existing = this.waiters.get(eventId);
    if (existing !== undefined) {
      return existing;
    }

    let resolve!: (outcome: ShortcutProviderOutcome) => void;
    const promise = new Promise<ShortcutProviderOutcome>((resolver) => {
      resolve = resolver;
    });
    const waiter = { promise, resolve };
    this.waiters.set(eventId, waiter);
    return waiter;
  }
}

class FixtureShortcutTransactionNotificationProvider
  implements ShortcutTransactionNotificationProvider
{
  private readonly calls: ShortcutProviderSendCall[] = [];

  constructor(private readonly outcome: ShortcutProviderOutcome) {}

  async sendOne(input: {
    eventId: string;
    endpointId: string;
    fid: string;
    payload: NotificationTarget["payload"];
  }): Promise<ShortcutProviderOutcome> {
    this.calls.push({ ...input, payload: { ...input.payload }, operation: "sendOne" });
    return this.outcome;
  }

  sentCalls(): readonly ShortcutProviderSendCall[] {
    return this.calls.map((call) => ({ ...call, payload: { ...call.payload } }));
  }
}

export function createShortcutTransactionConsumerFixtureSubject(
  fixture: ShortcutTransactionConsumerFixture,
): ShortcutTransactionConsumerFixtureSubject {
  const store = new FixtureShortcutTransactionNotificationStore();
  const provider = new FixtureShortcutTransactionNotificationProvider(
    fixture.providerOutcome,
  );
  const input = createShortcutTransactionNotificationConsumer(
    createNotificationTargetPlanner(),
    new FixtureShortcutNotificationFactsQuery(fixture.creatorEndpoint),
    store,
    provider,
  );

  return {
    consume: (event) => input.consume(event),
    providerSendCalls: () => provider.sentCalls(),
    snapshot: () => store.snapshot(fixture.sourceLedgerDigest),
  };
}
