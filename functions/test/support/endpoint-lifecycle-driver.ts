import { createHash } from "node:crypto";

import { createEndpointLifecycleApplication } from "../../src/contexts/notifications/application/endpointLifecycleApplication";
import type {
  EndpointCommandReceipt,
  EndpointLifecycleTransaction,
  EndpointLifecycleUnitOfWork,
} from "../../src/contexts/notifications/application/ports/outbound/endpointLifecycleUnitOfWork";
import type { MobileEndpointIdentityPort } from "../../src/contexts/notifications/application/ports/outbound/mobileEndpointRegistrationStore";
import type { MobileNotificationEndpoint } from "../../src/contexts/notifications/domain/model/mobileNotificationEndpoint";
import type {
  EndpointLifecycleInputPort,
  EndpointView,
} from "../../src/contexts/notifications/public";

export interface EndpointSeed extends EndpointView {
  fid: string;
}

export interface EndpointLifecycleFixture {
  endpoints?: readonly EndpointSeed[];
}

export type EndpointLifecycleFixtureSubject = EndpointLifecycleInputPort;

function cloneEndpoint(
  endpoint: MobileNotificationEndpoint,
): MobileNotificationEndpoint {
  return {
    ...endpoint,
    deviceInfo: { ...endpoint.deviceInfo },
  };
}

function cloneReceipt(receipt: EndpointCommandReceipt): EndpointCommandReceipt {
  return {
    ...receipt,
    result: { ...receipt.result },
  } as EndpointCommandReceipt;
}

class FixtureLifecycleTransaction implements EndpointLifecycleTransaction {
  constructor(
    private readonly endpointId: string,
    private readonly endpoints: Map<string, MobileNotificationEndpoint>,
    private readonly receipts: Map<string, EndpointCommandReceipt>,
  ) {}

  async readEndpoint(): Promise<MobileNotificationEndpoint | null> {
    const endpoint = this.endpoints.get(this.endpointId);
    return endpoint === undefined ? null : cloneEndpoint(endpoint);
  }

  async saveEndpoint(endpoint: MobileNotificationEndpoint): Promise<void> {
    if (endpoint.endpointId !== this.endpointId) {
      throw new Error("transaction endpoint identity mismatch");
    }
    this.endpoints.set(this.endpointId, cloneEndpoint(endpoint));
  }

  async removeEndpoint(): Promise<void> {
    this.endpoints.delete(this.endpointId);
  }

  async readReceipt(
    idempotencyKey: string,
  ): Promise<EndpointCommandReceipt | null> {
    const receipt = this.receipts.get(idempotencyKey);
    return receipt === undefined ? null : cloneReceipt(receipt);
  }

  async saveReceipt(receipt: EndpointCommandReceipt): Promise<void> {
    this.receipts.set(receipt.idempotencyKey, cloneReceipt(receipt));
  }
}

class FixtureLifecycleUnitOfWork implements EndpointLifecycleUnitOfWork {
  private endpoints: Map<string, MobileNotificationEndpoint>;
  private receipts = new Map<string, EndpointCommandReceipt>();
  private transactionTail: Promise<void> = Promise.resolve();

  constructor(seeds: readonly EndpointSeed[]) {
    this.endpoints = new Map(
      seeds.map((seed) => [
        seed.endpointId,
        {
          endpointId: seed.endpointId,
          fid: seed.fid,
          householdId: seed.householdId,
          memberId: seed.memberId,
          platform: seed.platform,
          status: seed.status,
          registrationVersion: seed.registrationVersion,
          bindingVersion: seed.bindingVersion,
          deviceInfo: {},
          registeredAt: seed.lastConfirmedAt,
          lastConfirmedAt: seed.lastConfirmedAt,
          ...(seed.inactiveAt === undefined
            ? {}
            : { inactiveAt: seed.inactiveAt }),
          ...(seed.expiresAt === undefined
            ? {}
            : { expiresAt: seed.expiresAt }),
        },
      ]),
    );
  }

  async runForEndpoint<T>(
    endpointId: string,
    operation: (transaction: EndpointLifecycleTransaction) => Promise<T>,
  ): Promise<T> {
    const previous = this.transactionTail;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.transactionTail = previous.then(() => gate);

    await previous;
    try {
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
      const result = await operation(
        new FixtureLifecycleTransaction(
          endpointId,
          workingEndpoints,
          workingReceipts,
        ),
      );
      this.endpoints = workingEndpoints;
      this.receipts = workingReceipts;
      return result;
    } finally {
      release();
    }
  }

  async listByHousehold(
    householdId: string,
  ): Promise<readonly MobileNotificationEndpoint[]> {
    return [...this.endpoints.values()]
      .filter((endpoint) => endpoint.householdId === householdId)
      .map(cloneEndpoint);
  }
}

class FixtureEndpointIdentity implements MobileEndpointIdentityPort {
  private readonly seeded = new Map<string, string>();

  constructor(seeds: readonly EndpointSeed[]) {
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
      .update(`endpoint-lifecycle-fixture\u0000${fid}`)
      .digest("hex")
      .slice(0, 24);
    return `endpoint-${digest}`;
  }
}

export function createEndpointLifecycleFixtureSubject(
  fixture: EndpointLifecycleFixture = {},
): EndpointLifecycleFixtureSubject {
  const endpoints = fixture.endpoints ?? [];
  return createEndpointLifecycleApplication(
    new FixtureLifecycleUnitOfWork(endpoints),
    new FixtureEndpointIdentity(endpoints),
  );
}
