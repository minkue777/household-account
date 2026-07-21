import { createHash } from "node:crypto";

import { createNotificationSecurityBoundaryApplication } from "../../src/contexts/notifications/application/notificationSecurityBoundaryApplication";
import type { MobileEndpointIdentityPort } from "../../src/contexts/notifications/application/ports/outbound/mobileEndpointRegistrationStore";
import type {
  MemberCleanupStoreResult,
  NotificationMembershipQueryPort,
  NotificationSecurityClock,
  NotificationSecurityStore,
  SafeNotificationObservabilityPort,
  SecuredEndpointTransaction,
  SecuredRegistrationReceipt,
  StoredSecurityDelivery,
} from "../../src/contexts/notifications/application/ports/outbound/notificationSecurityPorts";
import type { MobileNotificationEndpoint } from "../../src/contexts/notifications/domain/model/mobileNotificationEndpoint";
import type {
  NotificationsSecurityBoundaryInputPort,
  PublicEndpointView,
  TerminalDeliveryView,
} from "../../src/contexts/notifications/public";

export interface SecuredEndpointSeed extends PublicEndpointView {
  fid: string;
}

export interface NotificationsSecurityFixture {
  memberships: Readonly<Record<string, "active" | "removed">>;
  endpoints?: readonly SecuredEndpointSeed[];
  terminalDeliveries?: readonly TerminalDeliveryView[];
}

export interface EndpointCommandSecurityTrace {
  commandId: string;
  endpointRepositoryReadCount: number;
  endpointRepositoryWriteCount: number;
}

export interface NotificationObservabilityRecord {
  name: string;
  endpointId?: string;
  resultCode: string;
}

export interface NotificationsSecurityFixtureSubject
  extends NotificationsSecurityBoundaryInputPort {
  endpointCommandSecurityTrace(
    commandId: string,
  ): Promise<EndpointCommandSecurityTrace>;
  observabilityRecords(): Promise<readonly NotificationObservabilityRecord[]>;
  publishedPublicEvents(): Promise<
    readonly Readonly<Record<string, unknown>>[]
  >;
  legacyMigrationReport(): Promise<{
    scannedLegacyRecordCount: number;
    activeEndpointCount: number;
    plaintextAddressCount: 0;
  }>;
  setMembershipStatus(
    householdId: string,
    memberId: string,
    status: "active" | "removed",
  ): void;
}

function membershipKey(householdId: string, memberId: string): string {
  return `${householdId}/${memberId}`;
}

function cloneEndpoint(
  endpoint: MobileNotificationEndpoint,
): MobileNotificationEndpoint {
  return { ...endpoint, deviceInfo: { ...endpoint.deviceInfo } };
}

function cloneReceipt(
  receipt: SecuredRegistrationReceipt,
): SecuredRegistrationReceipt {
  return { ...receipt, result: { ...receipt.result } };
}

function cloneDelivery(delivery: StoredSecurityDelivery): StoredSecurityDelivery {
  return { ...delivery };
}

class FixtureMemberships implements NotificationMembershipQueryPort {
  private readonly statuses: Map<string, "active" | "removed">;

  constructor(fixture: NotificationsSecurityFixture["memberships"]) {
    this.statuses = new Map(Object.entries(fixture));
  }

  status(householdId: string, memberId: string) {
    return this.statuses.get(membershipKey(householdId, memberId)) ?? "missing";
  }

  set(
    householdId: string,
    memberId: string,
    status: "active" | "removed",
  ): void {
    this.statuses.set(membershipKey(householdId, memberId), status);
  }
}

class FixtureSecurityTransaction implements SecuredEndpointTransaction {
  constructor(
    private readonly endpointId: string,
    private readonly endpoints: Map<string, MobileNotificationEndpoint>,
    private readonly receipts: Map<string, SecuredRegistrationReceipt>,
    private readonly trace: EndpointCommandSecurityTrace | undefined,
  ) {}

  async readEndpoint(): Promise<MobileNotificationEndpoint | null> {
    if (this.trace !== undefined) {
      this.trace.endpointRepositoryReadCount += 1;
    }
    const endpoint = this.endpoints.get(this.endpointId);
    return endpoint === undefined ? null : cloneEndpoint(endpoint);
  }

  async saveEndpoint(endpoint: MobileNotificationEndpoint): Promise<void> {
    if (endpoint.endpointId !== this.endpointId) {
      throw new Error("transaction endpoint identity mismatch");
    }
    if (this.trace !== undefined) {
      this.trace.endpointRepositoryWriteCount += 1;
    }
    this.endpoints.set(this.endpointId, cloneEndpoint(endpoint));
  }

  async removeEndpoint(): Promise<void> {
    if (this.trace !== undefined) {
      this.trace.endpointRepositoryWriteCount += 1;
    }
    this.endpoints.delete(this.endpointId);
  }

  async readRegistrationReceipt(
    idempotencyKey: string,
  ): Promise<SecuredRegistrationReceipt | null> {
    const receipt = this.receipts.get(idempotencyKey);
    return receipt === undefined ? null : cloneReceipt(receipt);
  }

  async saveRegistrationReceipt(
    receipt: SecuredRegistrationReceipt,
  ): Promise<void> {
    this.receipts.set(receipt.idempotencyKey, cloneReceipt(receipt));
  }
}

class FixtureNotificationSecurityStore implements NotificationSecurityStore {
  private endpoints: Map<string, MobileNotificationEndpoint>;
  private receipts = new Map<string, SecuredRegistrationReceipt>();
  private cleanupReceipts = new Map<string, number>();
  private deliveries: Map<string, StoredSecurityDelivery>;
  private readonly traces = new Map<string, EndpointCommandSecurityTrace>();
  private transactionTail: Promise<void> = Promise.resolve();

  constructor(
    endpointSeeds: readonly SecuredEndpointSeed[],
    terminalDeliveries: readonly TerminalDeliveryView[],
  ) {
    this.endpoints = new Map(
      endpointSeeds.map((seed) => [
        seed.endpointId,
        {
          ...seed,
          deviceInfo: {},
          registeredAt: "2026-07-18T00:00:00.000Z",
          lastConfirmedAt: "2026-07-18T00:00:00.000Z",
        },
      ]),
    );
    this.deliveries = new Map(
      terminalDeliveries.map((delivery) => [
        delivery.deliveryId,
        cloneDelivery(delivery),
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

  async runEndpointCommand<T>(
    commandId: string | undefined,
    endpointId: string,
    operation: (transaction: SecuredEndpointTransaction) => Promise<T>,
  ): Promise<T> {
    return this.exclusive(async () => {
      const workingEndpoints = new Map(
        [...this.endpoints].map(([key, endpoint]) => [
          key,
          cloneEndpoint(endpoint),
        ]),
      );
      const workingReceipts = new Map(
        [...this.receipts].map(([key, receipt]) => [
          key,
          cloneReceipt(receipt),
        ]),
      );
      const trace =
        commandId === undefined
          ? undefined
          : this.traces.get(commandId) ?? {
              commandId,
              endpointRepositoryReadCount: 0,
              endpointRepositoryWriteCount: 0,
            };
      if (trace !== undefined) {
        this.traces.set(commandId as string, trace);
      }

      const result = await operation(
        new FixtureSecurityTransaction(
          endpointId,
          workingEndpoints,
          workingReceipts,
          trace,
        ),
      );
      this.endpoints = workingEndpoints;
      this.receipts = workingReceipts;
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

  async cleanupMemberEndpoints(
    eventId: string,
    householdId: string,
    memberId: string,
  ): Promise<MemberCleanupStoreResult> {
    return this.exclusive(async () => {
      const previousCount = this.cleanupReceipts.get(eventId);
      if (previousCount !== undefined) {
        return { replayed: true, removedEndpointCount: previousCount };
      }

      let removedEndpointCount = 0;
      for (const [endpointId, endpoint] of this.endpoints) {
        if (
          endpoint.householdId === householdId &&
          endpoint.memberId === memberId
        ) {
          this.endpoints.delete(endpointId);
          removedEndpointCount += 1;
        }
      }
      this.cleanupReceipts.set(eventId, removedEndpointCount);
      return { replayed: false, removedEndpointCount };
    });
  }

  async saveDeliveries(
    deliveries: readonly StoredSecurityDelivery[],
  ): Promise<void> {
    for (const delivery of deliveries) {
      this.deliveries.set(delivery.deliveryId, cloneDelivery(delivery));
    }
  }

  async readDelivery(
    deliveryId: string,
  ): Promise<StoredSecurityDelivery | null> {
    const delivery = this.deliveries.get(deliveryId);
    return delivery === undefined ? null : cloneDelivery(delivery);
  }

  async saveDelivery(delivery: StoredSecurityDelivery): Promise<void> {
    this.deliveries.set(delivery.deliveryId, cloneDelivery(delivery));
  }

  async listDeliveries(
    householdId: string,
  ): Promise<readonly StoredSecurityDelivery[]> {
    return [...this.deliveries.values()]
      .filter((delivery) => delivery.householdId === householdId)
      .map(cloneDelivery);
  }

  trace(commandId: string): EndpointCommandSecurityTrace {
    return {
      ...(this.traces.get(commandId) ?? {
        commandId,
        endpointRepositoryReadCount: 0,
        endpointRepositoryWriteCount: 0,
      }),
    };
  }

  activeEndpointCount(): number {
    return [...this.endpoints.values()].filter(
      (endpoint) => endpoint.status === "active",
    ).length;
  }
}

class FixtureEndpointIdentity implements MobileEndpointIdentityPort {
  private readonly seeded = new Map<string, string>();

  constructor(seeds: readonly SecuredEndpointSeed[]) {
    for (const seed of seeds) {
      this.seeded.set(seed.fid, seed.endpointId);
    }
  }

  endpointIdFor(fid: string): string {
    const seededId = this.seeded.get(fid);
    if (seededId !== undefined) {
      return seededId;
    }
    const digest = createHash("sha256")
      .update(`notification-security-fixture\u0000${fid}`)
      .digest("hex")
      .slice(0, 24);
    return `endpoint-${digest}`;
  }
}

class FixtureClock implements NotificationSecurityClock {
  private tick = 0;

  now(): string {
    const value = Date.parse("2026-07-20T00:00:00.000Z") + this.tick;
    this.tick += 1;
    return new Date(value).toISOString();
  }
}

class FixtureObservability implements SafeNotificationObservabilityPort {
  private readonly records: NotificationObservabilityRecord[] = [];

  record(input: NotificationObservabilityRecord): void {
    this.records.push({ ...input });
  }

  list(): readonly NotificationObservabilityRecord[] {
    return this.records.map((record) => ({ ...record }));
  }
}

export function createNotificationSecurityBoundaryFixtureSubject(
  fixture: NotificationsSecurityFixture,
): NotificationsSecurityFixtureSubject {
  const endpointSeeds = fixture.endpoints ?? [];
  const memberships = new FixtureMemberships(fixture.memberships);
  const store = new FixtureNotificationSecurityStore(
    endpointSeeds,
    fixture.terminalDeliveries ?? [],
  );
  const observability = new FixtureObservability();
  const application = createNotificationSecurityBoundaryApplication(
    memberships,
    store,
    new FixtureEndpointIdentity(endpointSeeds),
    new FixtureClock(),
    observability,
  );

  return {
    register: (command) => application.register(command),
    remove: (input) => application.remove(input),
    acceptExplicitRequest: (event) =>
      application.acceptExplicitRequest(event),
    deliver: (deliveryId) => application.deliver(deliveryId),
    getDeliveryStatus: (input) => application.getDeliveryStatus(input),
    handleMemberRemoved: (event) => application.handleMemberRemoved(event),
    listEndpointViews: (householdId) =>
      application.listEndpointViews(householdId),
    listTerminalDeliveries: (householdId) =>
      application.listTerminalDeliveries(householdId),
    endpointCommandSecurityTrace: async (commandId) => store.trace(commandId),
    observabilityRecords: async () => observability.list(),
    publishedPublicEvents: async () => [],
    legacyMigrationReport: async () => ({
      scannedLegacyRecordCount: 0,
      activeEndpointCount: store.activeEndpointCount(),
      plaintextAddressCount: 0,
    }),
    setMembershipStatus: (householdId, memberId, status) =>
      memberships.set(householdId, memberId, status),
  };
}
