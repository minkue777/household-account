import { createDeliveryAssuranceApplication } from "../../src/contexts/notifications/application/deliveryAssuranceApplication";
import type {
  AssuredDeliveryTransaction,
  DeliveryAcceptanceTransaction,
  DeliveryAssuranceClock,
  DeliveryAssuranceProviderPort,
  DeliveryAssuranceStore,
  DeliveryMembershipQueryPort,
  DeliveryMembershipStatus,
  StoredAssuredDelivery,
  StoredDeliveryAssuranceInbox,
  StoredDeliveryAssuranceIntent,
} from "../../src/contexts/notifications/application/ports/outbound/deliveryAssurancePorts";
import type { NotificationProviderOutcome } from "../../src/contexts/notifications/domain/model/deliveryAssurance";
import type { MobileNotificationEndpoint } from "../../src/contexts/notifications/domain/model/mobileNotificationEndpoint";
import {
  createNotificationTargetPlanner,
  type DeliveryAssuranceInputPort,
} from "../../src/contexts/notifications/public";

export interface DeliveryEndpointSeed {
  endpointId: string;
  fid: string;
  householdId: string;
  memberId: string;
  platform: "android" | "ios-pwa";
  status: "active" | "inactive";
  registrationVersion: number;
  bindingVersion: number;
}

export interface DeliverySeed {
  deliveryId: string;
  intentId: string;
  eventId: string;
  householdId: string;
  recipientMemberId: string;
  endpointId: string;
  expectedRegistrationVersion: number;
  expectedBindingVersion: number;
  status: "queued";
}

export type ProviderOutcome = NotificationProviderOutcome;

export interface ProviderSendCallView {
  deliveryId: string;
  endpointId: string;
  fid: string;
  operation: "sendOne";
}

export interface DeliveryAssuranceFixture {
  now: string;
  endpoints: readonly DeliveryEndpointSeed[];
  memberships: Readonly<Record<string, DeliveryMembershipStatus>>;
  deliveries?: readonly DeliverySeed[];
  providerOutcomeByEndpointId?: Readonly<Record<string, ProviderOutcome>>;
  inboxEventIds?: readonly string[];
  endpointChangeBeforeResultCommit?: Readonly<
    Record<string, { registrationVersion: number; bindingVersion: number }>
  >;
}

export interface DeliveryAssuranceFixtureSubject
  extends DeliveryAssuranceInputPort {
  providerSendCalls(): Promise<readonly ProviderSendCallView[]>;
}

function cloneEndpoint(
  endpoint: MobileNotificationEndpoint,
): MobileNotificationEndpoint {
  return { ...endpoint, deviceInfo: { ...endpoint.deviceInfo } };
}

function cloneInbox(
  inbox: StoredDeliveryAssuranceInbox,
): StoredDeliveryAssuranceInbox {
  return {
    ...inbox,
    ...(inbox.deliveryIds === undefined
      ? {}
      : { deliveryIds: [...inbox.deliveryIds] }),
  };
}

function cloneIntent(
  intent: StoredDeliveryAssuranceIntent,
): StoredDeliveryAssuranceIntent {
  return { ...intent };
}

function cloneDelivery(delivery: StoredAssuredDelivery): StoredAssuredDelivery {
  return { ...delivery };
}

function isTerminal(delivery: StoredAssuredDelivery): boolean {
  return delivery.status !== "queued" && delivery.status !== "sending";
}

class FixtureAcceptanceTransaction implements DeliveryAcceptanceTransaction {
  constructor(
    private readonly eventId: string,
    private readonly inbox: Map<string, StoredDeliveryAssuranceInbox>,
    private readonly intents: Map<string, StoredDeliveryAssuranceIntent>,
    private readonly deliveries: Map<string, StoredAssuredDelivery>,
  ) {}

  async readInbox(): Promise<StoredDeliveryAssuranceInbox | null> {
    const record = this.inbox.get(this.eventId);
    return record === undefined ? null : cloneInbox(record);
  }

  async saveInbox(record: StoredDeliveryAssuranceInbox): Promise<void> {
    if (record.eventId !== this.eventId) {
      throw new Error("Inbox event identity mismatch");
    }
    this.inbox.set(record.eventId, cloneInbox(record));
  }

  async saveIntent(record: StoredDeliveryAssuranceIntent): Promise<void> {
    this.intents.set(record.intentId, cloneIntent(record));
  }

  async saveDeliveries(
    records: readonly StoredAssuredDelivery[],
  ): Promise<void> {
    for (const record of records) {
      this.deliveries.set(record.deliveryId, cloneDelivery(record));
    }
  }
}

class FixtureAssuredDeliveryTransaction
  implements AssuredDeliveryTransaction
{
  constructor(
    private readonly deliveryId: string,
    private readonly deliveries: Map<string, StoredAssuredDelivery>,
    private readonly endpoints: Map<string, MobileNotificationEndpoint>,
  ) {}

  async readDelivery(): Promise<StoredAssuredDelivery | null> {
    const record = this.deliveries.get(this.deliveryId);
    return record === undefined ? null : cloneDelivery(record);
  }

  async saveDelivery(record: StoredAssuredDelivery): Promise<void> {
    if (record.deliveryId !== this.deliveryId) {
      throw new Error("Delivery identity mismatch");
    }
    this.deliveries.set(record.deliveryId, cloneDelivery(record));
  }

  async readEndpoint(
    endpointId: string,
  ): Promise<MobileNotificationEndpoint | null> {
    const endpoint = this.endpoints.get(endpointId);
    return endpoint === undefined ? null : cloneEndpoint(endpoint);
  }

  async saveEndpoint(endpoint: MobileNotificationEndpoint): Promise<void> {
    this.endpoints.set(endpoint.endpointId, cloneEndpoint(endpoint));
  }
}

interface TerminalWaiter {
  promise: Promise<StoredAssuredDelivery>;
  resolve: (delivery: StoredAssuredDelivery) => void;
}

class FixtureDeliveryAssuranceStore implements DeliveryAssuranceStore {
  private inbox: Map<string, StoredDeliveryAssuranceInbox>;
  private intents: Map<string, StoredDeliveryAssuranceIntent>;
  private deliveries: Map<string, StoredAssuredDelivery>;
  private endpoints: Map<string, MobileNotificationEndpoint>;
  private readonly waiters = new Map<string, TerminalWaiter>();
  private transactionTail: Promise<void> = Promise.resolve();

  constructor(fixture: DeliveryAssuranceFixture) {
    this.endpoints = new Map(
      fixture.endpoints.map((endpoint) => [
        endpoint.endpointId,
        {
          ...endpoint,
          deviceInfo: {},
          registeredAt: fixture.now,
          lastConfirmedAt: fixture.now,
        },
      ]),
    );
    const deliverySeeds = fixture.deliveries ?? [];
    this.deliveries = new Map(
      deliverySeeds.map((delivery) => [
        delivery.deliveryId,
        { ...delivery, providerAttemptCount: 0 },
      ]),
    );
    this.intents = new Map();
    for (const delivery of deliverySeeds) {
      if (!this.intents.has(delivery.intentId)) {
        this.intents.set(delivery.intentId, {
          intentId: delivery.intentId,
          eventId: delivery.eventId,
          householdId: delivery.householdId,
        });
      }
    }
    this.inbox = new Map(
      (fixture.inboxEventIds ?? []).map((eventId) => [
        eventId,
        { eventId, status: "accepted" },
      ]),
    );
  }

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

  async readInbox(
    eventId: string,
  ): Promise<StoredDeliveryAssuranceInbox | null> {
    const record = this.inbox.get(eventId);
    return record === undefined ? null : cloneInbox(record);
  }

  async runAcceptance<T>(
    eventId: string,
    operation: (transaction: DeliveryAcceptanceTransaction) => Promise<T>,
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
          eventId,
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

  async listEndpoints(
    householdId: string,
  ): Promise<readonly MobileNotificationEndpoint[]> {
    return [...this.endpoints.values()]
      .filter((endpoint) => endpoint.householdId === householdId)
      .map(cloneEndpoint);
  }

  async runForDelivery<T>(
    deliveryId: string,
    operation: (transaction: AssuredDeliveryTransaction) => Promise<T>,
  ): Promise<T> {
    return this.exclusive(async () => {
      const workingDeliveries = new Map(
        [...this.deliveries].map(([key, value]) => [key, cloneDelivery(value)]),
      );
      const workingEndpoints = new Map(
        [...this.endpoints].map(([key, value]) => [key, cloneEndpoint(value)]),
      );
      const result = await operation(
        new FixtureAssuredDeliveryTransaction(
          deliveryId,
          workingDeliveries,
          workingEndpoints,
        ),
      );
      this.deliveries = workingDeliveries;
      this.endpoints = workingEndpoints;

      const committed = this.deliveries.get(deliveryId);
      if (committed?.status === "sending") {
        this.ensureWaiter(deliveryId);
      } else if (committed !== undefined && isTerminal(committed)) {
        this.waiters.get(deliveryId)?.resolve(cloneDelivery(committed));
        this.waiters.delete(deliveryId);
      }
      return result;
    });
  }

  async waitForTerminalDelivery(
    deliveryId: string,
  ): Promise<StoredAssuredDelivery> {
    const delivery = this.deliveries.get(deliveryId);
    if (delivery !== undefined && isTerminal(delivery)) {
      return cloneDelivery(delivery);
    }
    if (delivery?.status !== "sending") {
      throw new Error(`Delivery is not in progress: ${deliveryId}`);
    }
    return this.ensureWaiter(deliveryId).promise;
  }

  async readDelivery(
    deliveryId: string,
  ): Promise<StoredAssuredDelivery | null> {
    const delivery = this.deliveries.get(deliveryId);
    return delivery === undefined ? null : cloneDelivery(delivery);
  }

  async readIntent(
    intentId: string,
  ): Promise<StoredDeliveryAssuranceIntent | null> {
    const intent = this.intents.get(intentId);
    return intent === undefined ? null : cloneIntent(intent);
  }

  async listIntentDeliveries(
    intentId: string,
  ): Promise<readonly StoredAssuredDelivery[]> {
    return [...this.deliveries.values()]
      .filter((delivery) => delivery.intentId === intentId)
      .map(cloneDelivery);
  }

  async listIntents(
    householdId: string,
  ): Promise<readonly StoredDeliveryAssuranceIntent[]> {
    return [...this.intents.values()]
      .filter((intent) => intent.householdId === householdId)
      .map(cloneIntent);
  }

  async completeIntent(input: {
    intentId: string;
    eventId: string;
    terminalAt: string;
    expiresAt: string;
  }): Promise<void> {
    await this.exclusive(async () => {
      const intent = this.intents.get(input.intentId);
      const inbox = this.inbox.get(input.eventId);
      if (intent === undefined || inbox === undefined) {
        throw new Error("NOTIFICATION_INTENT_NOT_FOUND");
      }
      this.intents.set(input.intentId, {
        ...intent,
        status: "terminal",
        terminalAt: input.terminalAt,
        expiresAt: input.expiresAt,
      });
      this.inbox.set(input.eventId, {
        ...inbox,
        status: "terminal",
        terminalAt: input.terminalAt,
        expiresAt: input.expiresAt,
      });
    });
  }

  async changeEndpointVersions(
    endpointId: string,
    versions: { registrationVersion: number; bindingVersion: number },
  ): Promise<void> {
    await this.exclusive(async () => {
      const endpoint = this.endpoints.get(endpointId);
      if (endpoint !== undefined) {
        this.endpoints.set(endpointId, { ...endpoint, ...versions });
      }
    });
  }

  private ensureWaiter(deliveryId: string): TerminalWaiter {
    const existing = this.waiters.get(deliveryId);
    if (existing !== undefined) {
      return existing;
    }

    let resolve!: (delivery: StoredAssuredDelivery) => void;
    const promise = new Promise<StoredAssuredDelivery>((resolver) => {
      resolve = resolver;
    });
    const waiter = { promise, resolve };
    this.waiters.set(deliveryId, waiter);
    return waiter;
  }
}

class FixtureMembershipQuery implements DeliveryMembershipQueryPort {
  constructor(
    private readonly memberships: Readonly<
      Record<string, DeliveryMembershipStatus>
    >,
  ) {}

  async status(
    _householdId: string,
    memberId: string,
  ): Promise<DeliveryMembershipStatus> {
    return this.memberships[memberId] ?? "removed";
  }
}

class FixtureDeliveryProvider implements DeliveryAssuranceProviderPort {
  private readonly calls: ProviderSendCallView[] = [];

  constructor(
    private readonly outcomes: Readonly<Record<string, ProviderOutcome>>,
    private readonly endpointChanges: Readonly<
      Record<string, { registrationVersion: number; bindingVersion: number }>
    >,
    private readonly store: FixtureDeliveryAssuranceStore,
  ) {}

  async sendOne(input: {
    deliveryId: string;
    endpointId: string;
    fid: string;
  }): Promise<ProviderOutcome> {
    this.calls.push({ ...input, operation: "sendOne" });
    const change = this.endpointChanges[input.deliveryId];
    if (change !== undefined) {
      await this.store.changeEndpointVersions(input.endpointId, change);
    }
    return this.outcomes[input.endpointId] ?? { kind: "success" };
  }

  sentCalls(): readonly ProviderSendCallView[] {
    return this.calls.map((call) => ({ ...call }));
  }
}

class FixtureClock implements DeliveryAssuranceClock {
  constructor(private readonly value: string) {}

  now(): string {
    return this.value;
  }
}

export function createDeliveryAssuranceFixtureSubject(
  fixture: DeliveryAssuranceFixture,
): DeliveryAssuranceFixtureSubject {
  const store = new FixtureDeliveryAssuranceStore(fixture);
  const provider = new FixtureDeliveryProvider(
    fixture.providerOutcomeByEndpointId ?? {},
    fixture.endpointChangeBeforeResultCommit ?? {},
    store,
  );
  const input = createDeliveryAssuranceApplication(
    createNotificationTargetPlanner(),
    new FixtureMembershipQuery(fixture.memberships),
    store,
    provider,
    new FixtureClock(fixture.now),
  );

  return {
    accept: (event) => input.accept(event),
    deliver: (deliveryId) => input.deliver(deliveryId),
    completeIntent: (intentId) => input.completeIntent(intentId),
    getDeliveryStatus: (intentId) => input.getDeliveryStatus(intentId),
    listDeliveryStatuses: (householdId) =>
      input.listDeliveryStatuses(householdId),
    listEndpointStatuses: (householdId) =>
      input.listEndpointStatuses(householdId),
    getInboxStatus: (eventId) => input.getInboxStatus(eventId),
    getTerminalRetentionDisposition: (deliveryId, now) =>
      input.getTerminalRetentionDisposition(deliveryId, now),
    providerSendCalls: async () => provider.sentCalls(),
  };
}
