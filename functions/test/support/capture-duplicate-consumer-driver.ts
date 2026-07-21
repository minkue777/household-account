import { createCaptureDuplicateNotificationConsumer } from "../../src/contexts/notifications/application/captureDuplicateNotificationConsumer";
import type {
  CaptureDuplicateAcceptanceTransaction,
  CaptureDuplicateDeliveryRecord,
  CaptureDuplicateDeliveryTransaction,
  CaptureDuplicateInboxRecord,
  CaptureDuplicateIntentRecord,
  CaptureDuplicateNotificationProvider,
  CaptureDuplicateNotificationStore,
  DuplicateDeliveryTerminalStatus,
  DuplicateNotificationEndpointRecord,
} from "../../src/contexts/notifications/application/ports/outbound/captureDuplicateNotificationPorts";
import type {
  CaptureDuplicateNotificationInputPort,
  CaptureDuplicateObservedEvent,
} from "../../src/contexts/notifications/public";

export interface DuplicateNotificationEndpoint
  extends DuplicateNotificationEndpointRecord {}

export interface CaptureDuplicateNotificationSnapshot {
  inboxEventIds: readonly string[];
  intents: readonly {
    intentId: string;
    eventId: string;
    transactionId: string;
    recipientMemberId: string;
    status: "no-target" | "queued" | "delivered" | "failed";
  }[];
  deliveries: readonly {
    deliveryId: string;
    endpointId: string;
    status:
      | "queued"
      | "delivered"
      | "failed"
      | "unknown-provider-outcome"
      | "permanent-failure";
  }[];
  createdTransactionIds: readonly string[];
  sourceLedgerDigest: string;
}

export interface DuplicateProviderSendCall {
  deliveryId: string;
  endpointId: string;
  fid: string;
  operation: "sendOne";
}

export interface CaptureDuplicateConsumerFixture {
  endpoints: readonly DuplicateNotificationEndpoint[];
  sourceLedgerDigest: string;
  deliveryOutcomeByEndpointId?: Readonly<
    Record<string, DuplicateDeliveryTerminalStatus>
  >;
}

export interface CaptureDuplicateConsumerFixtureSubject
  extends CaptureDuplicateNotificationInputPort {
  providerSendCalls(): Promise<readonly DuplicateProviderSendCall[]>;
  snapshot(): Promise<CaptureDuplicateNotificationSnapshot>;
}

function cloneInbox(record: CaptureDuplicateInboxRecord): CaptureDuplicateInboxRecord {
  return { ...record, deliveryIds: [...record.deliveryIds] };
}

function cloneIntent(
  record: CaptureDuplicateIntentRecord,
): CaptureDuplicateIntentRecord {
  return { ...record };
}

function cloneDelivery(
  record: CaptureDuplicateDeliveryRecord,
): CaptureDuplicateDeliveryRecord {
  return { ...record };
}

class FixtureAcceptanceTransaction
  implements CaptureDuplicateAcceptanceTransaction
{
  constructor(
    private readonly eventId: string,
    private readonly endpoints: readonly DuplicateNotificationEndpointRecord[],
    private readonly inbox: Map<string, CaptureDuplicateInboxRecord>,
    private readonly intents: Map<string, CaptureDuplicateIntentRecord>,
    private readonly deliveries: Map<string, CaptureDuplicateDeliveryRecord>,
  ) {}

  async readInbox(): Promise<CaptureDuplicateInboxRecord | null> {
    const record = this.inbox.get(this.eventId);
    return record === undefined ? null : cloneInbox(record);
  }

  async listEndpoints(): Promise<readonly DuplicateNotificationEndpointRecord[]> {
    return this.endpoints.map((endpoint) => ({ ...endpoint }));
  }

  async saveInbox(record: CaptureDuplicateInboxRecord): Promise<void> {
    if (record.eventId !== this.eventId) {
      throw new Error("Inbox event identity mismatch");
    }
    this.inbox.set(record.eventId, cloneInbox(record));
  }

  async saveIntent(record: CaptureDuplicateIntentRecord): Promise<void> {
    this.intents.set(record.intentId, cloneIntent(record));
  }

  async saveDeliveries(
    records: readonly CaptureDuplicateDeliveryRecord[],
  ): Promise<void> {
    for (const record of records) {
      this.deliveries.set(record.deliveryId, cloneDelivery(record));
    }
  }
}

class FixtureDeliveryTransaction
  implements CaptureDuplicateDeliveryTransaction
{
  constructor(
    private readonly deliveryId: string,
    private readonly intents: Map<string, CaptureDuplicateIntentRecord>,
    private readonly deliveries: Map<string, CaptureDuplicateDeliveryRecord>,
  ) {}

  async readDelivery(): Promise<CaptureDuplicateDeliveryRecord | null> {
    const record = this.deliveries.get(this.deliveryId);
    return record === undefined ? null : cloneDelivery(record);
  }

  async saveDelivery(record: CaptureDuplicateDeliveryRecord): Promise<void> {
    if (record.deliveryId !== this.deliveryId) {
      throw new Error("Delivery identity mismatch");
    }
    this.deliveries.set(record.deliveryId, cloneDelivery(record));
  }

  async readIntent(
    intentId: string,
  ): Promise<CaptureDuplicateIntentRecord | null> {
    const record = this.intents.get(intentId);
    return record === undefined ? null : cloneIntent(record);
  }

  async saveIntent(record: CaptureDuplicateIntentRecord): Promise<void> {
    this.intents.set(record.intentId, cloneIntent(record));
  }

  async listIntentDeliveries(
    intentId: string,
  ): Promise<readonly CaptureDuplicateDeliveryRecord[]> {
    return [...this.deliveries.values()]
      .filter((delivery) => delivery.intentId === intentId)
      .map(cloneDelivery);
  }
}

interface TerminalWaiter {
  promise: Promise<DuplicateDeliveryTerminalStatus>;
  resolve: (status: DuplicateDeliveryTerminalStatus) => void;
}

function isTerminal(
  status: CaptureDuplicateDeliveryRecord["status"],
): status is DuplicateDeliveryTerminalStatus {
  return status !== "queued" && status !== "sending";
}

class FixtureCaptureDuplicateStore
  implements CaptureDuplicateNotificationStore
{
  private inbox = new Map<string, CaptureDuplicateInboxRecord>();
  private intents = new Map<string, CaptureDuplicateIntentRecord>();
  private deliveries = new Map<string, CaptureDuplicateDeliveryRecord>();
  private readonly terminalWaiters = new Map<string, TerminalWaiter>();
  private transactionTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly endpoints: readonly DuplicateNotificationEndpointRecord[],
  ) {}

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

  async runAcceptance<T>(
    event: CaptureDuplicateObservedEvent,
    operation: (
      transaction: CaptureDuplicateAcceptanceTransaction,
    ) => Promise<T>,
  ): Promise<T> {
    return this.exclusive(async () => {
      const workingInbox = new Map(
        [...this.inbox].map(([key, value]) => [key, cloneInbox(value)]),
      );
      const workingIntents = new Map(
        [...this.intents].map(([key, value]) => [key, cloneIntent(value)]),
      );
      const workingDeliveries = new Map(
        [...this.deliveries].map(([key, value]) => [key, cloneDelivery(value)]),
      );
      const result = await operation(
        new FixtureAcceptanceTransaction(
          event.eventId,
          this.endpoints,
          workingInbox,
          workingIntents,
          workingDeliveries,
        ),
      );
      this.inbox = workingInbox;
      this.intents = workingIntents;
      this.deliveries = workingDeliveries;
      return result;
    });
  }

  async runForDelivery<T>(
    deliveryId: string,
    operation: (
      transaction: CaptureDuplicateDeliveryTransaction,
    ) => Promise<T>,
  ): Promise<T> {
    return this.exclusive(async () => {
      const workingIntents = new Map(
        [...this.intents].map(([key, value]) => [key, cloneIntent(value)]),
      );
      const workingDeliveries = new Map(
        [...this.deliveries].map(([key, value]) => [key, cloneDelivery(value)]),
      );
      const result = await operation(
        new FixtureDeliveryTransaction(
          deliveryId,
          workingIntents,
          workingDeliveries,
        ),
      );
      this.intents = workingIntents;
      this.deliveries = workingDeliveries;

      const committed = this.deliveries.get(deliveryId);
      if (committed?.status === "sending") {
        this.ensureTerminalWaiter(deliveryId);
      } else if (committed !== undefined && isTerminal(committed.status)) {
        this.terminalWaiters.get(deliveryId)?.resolve(committed.status);
        this.terminalWaiters.delete(deliveryId);
      }
      return result;
    });
  }

  async waitForTerminalDelivery(
    deliveryId: string,
  ): Promise<DuplicateDeliveryTerminalStatus> {
    const current = this.deliveries.get(deliveryId);
    if (current !== undefined && isTerminal(current.status)) {
      return current.status;
    }
    if (current?.status !== "sending") {
      throw new Error(`Delivery is not in progress: ${deliveryId}`);
    }
    return this.ensureTerminalWaiter(deliveryId).promise;
  }

  private ensureTerminalWaiter(deliveryId: string): TerminalWaiter {
    const current = this.terminalWaiters.get(deliveryId);
    if (current !== undefined) {
      return current;
    }

    let resolve!: (status: DuplicateDeliveryTerminalStatus) => void;
    const promise = new Promise<DuplicateDeliveryTerminalStatus>(
      (resolver) => {
        resolve = resolver;
      },
    );
    const waiter = { promise, resolve };
    this.terminalWaiters.set(deliveryId, waiter);
    return waiter;
  }

  snapshot(sourceLedgerDigest: string): CaptureDuplicateNotificationSnapshot {
    return {
      inboxEventIds: [...this.inbox.keys()].sort(),
      intents: [...this.intents.values()]
        .sort((left, right) => left.intentId.localeCompare(right.intentId))
        .map(cloneIntent),
      deliveries: [...this.deliveries.values()]
        .sort((left, right) => left.deliveryId.localeCompare(right.deliveryId))
        .map((delivery) => ({
          deliveryId: delivery.deliveryId,
          endpointId: delivery.endpointId,
          status: delivery.status === "sending" ? "queued" : delivery.status,
        })),
      createdTransactionIds: [],
      sourceLedgerDigest,
    };
  }
}

class FixtureCaptureDuplicateProvider
  implements CaptureDuplicateNotificationProvider
{
  private readonly calls: DuplicateProviderSendCall[] = [];

  constructor(
    private readonly outcomeByEndpointId: Readonly<
      Record<string, DuplicateDeliveryTerminalStatus>
    >,
  ) {}

  async sendOne(input: {
    deliveryId: string;
    endpointId: string;
    fid: string;
  }): Promise<DuplicateDeliveryTerminalStatus> {
    this.calls.push({ ...input, operation: "sendOne" });
    return this.outcomeByEndpointId[input.endpointId] ?? "delivered";
  }

  sentCalls(): readonly DuplicateProviderSendCall[] {
    return this.calls.map((call) => ({ ...call }));
  }
}

export function createCaptureDuplicateConsumerFixtureSubject(
  fixture: CaptureDuplicateConsumerFixture,
): CaptureDuplicateConsumerFixtureSubject {
  const store = new FixtureCaptureDuplicateStore(
    fixture.endpoints.map((endpoint) => ({ ...endpoint })),
  );
  const provider = new FixtureCaptureDuplicateProvider(
    fixture.deliveryOutcomeByEndpointId ?? {},
  );
  const input = createCaptureDuplicateNotificationConsumer(store, provider);

  return {
    accept: (event) => input.accept(event),
    deliver: (deliveryId) => input.deliver(deliveryId),
    providerSendCalls: async () => provider.sentCalls(),
    snapshot: async () => store.snapshot(fixture.sourceLedgerDigest),
  };
}
