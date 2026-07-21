import { createHash } from "node:crypto";

import { createMobileFidRegistrationController } from "../../src/contexts/notifications/application/mobileFidRegistrationController";
import type {
  MobileEndpointClock,
  MobileEndpointIdentityPort,
  MobileEndpointRegistrationStore,
  MobileEndpointRegistrationTransaction,
} from "../../src/contexts/notifications/application/ports/outbound/mobileEndpointRegistrationStore";
import type { MobileNotificationEndpoint } from "../../src/contexts/notifications/domain/model/mobileNotificationEndpoint";
import type {
  MobileEndpointDeviceInfo,
  MobileFidRegistrationInputPort,
  MobilePlatform,
  MobileSessionScope,
} from "../../src/contexts/notifications/public";

export interface MobileEndpointRegistrationSnapshot {
  session?: MobileSessionScope;
  endpoints: readonly {
    endpointId: string;
    householdId: string;
    memberId: string;
    platform: MobilePlatform;
    status: "active" | "inactive";
    registrationVersion: number;
    bindingVersion: number;
    deviceInfo: MobileEndpointDeviceInfo;
  }[];
}

export interface MobileFidRegistrationFixtureSubject
  extends MobileFidRegistrationInputPort {
  snapshot(): Promise<MobileEndpointRegistrationSnapshot>;
}

function cloneEndpoint(
  endpoint: MobileNotificationEndpoint,
): MobileNotificationEndpoint {
  return {
    ...endpoint,
    deviceInfo: { ...endpoint.deviceInfo },
  };
}

class FixtureEndpointTransaction
  implements MobileEndpointRegistrationTransaction
{
  constructor(
    private readonly endpointId: string,
    private readonly endpoints: Map<string, MobileNotificationEndpoint>,
  ) {}

  async read(): Promise<MobileNotificationEndpoint | null> {
    const endpoint = this.endpoints.get(this.endpointId);
    return endpoint === undefined ? null : cloneEndpoint(endpoint);
  }

  async save(endpoint: MobileNotificationEndpoint): Promise<void> {
    if (endpoint.endpointId !== this.endpointId) {
      throw new Error("transaction endpoint identity mismatch");
    }
    this.endpoints.set(this.endpointId, cloneEndpoint(endpoint));
  }

  async remove(): Promise<void> {
    this.endpoints.delete(this.endpointId);
  }
}

class FixtureEndpointStore implements MobileEndpointRegistrationStore {
  private endpoints = new Map<string, MobileNotificationEndpoint>();
  private transactionTail: Promise<void> = Promise.resolve();

  async runForEndpoint<T>(
    endpointId: string,
    operation: (
      transaction: MobileEndpointRegistrationTransaction,
    ) => Promise<T>,
  ): Promise<T> {
    const previous = this.transactionTail;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.transactionTail = previous.then(() => gate);

    await previous;
    try {
      const working = new Map(
        [...this.endpoints].map(([key, endpoint]) => [
          key,
          cloneEndpoint(endpoint),
        ]),
      );
      const result = await operation(
        new FixtureEndpointTransaction(endpointId, working),
      );
      this.endpoints = working;
      return result;
    } finally {
      release();
    }
  }

  snapshotEndpoints(): MobileEndpointRegistrationSnapshot["endpoints"] {
    return [...this.endpoints.values()]
      .sort((left, right) => left.endpointId.localeCompare(right.endpointId))
      .map((endpoint) => ({
        endpointId: endpoint.endpointId,
        householdId: endpoint.householdId,
        memberId: endpoint.memberId,
        platform: endpoint.platform,
        status: endpoint.status,
        registrationVersion: endpoint.registrationVersion,
        bindingVersion: endpoint.bindingVersion,
        deviceInfo: { ...endpoint.deviceInfo },
      }));
  }
}

class FixtureEndpointIdentity implements MobileEndpointIdentityPort {
  endpointIdFor(fid: string): string {
    const digest = createHash("sha256")
      .update(`mobile-fid-fixture\u0000${fid}`)
      .digest("hex")
      .slice(0, 24);
    return `endpoint-${digest}`;
  }
}

class FixtureClock implements MobileEndpointClock {
  private tick = 0;

  now(): string {
    const millis = Date.parse("2026-07-20T00:00:00.000Z") + this.tick;
    this.tick += 1;
    return new Date(millis).toISOString();
  }
}

export function createMobileFidRegistrationFixtureSubject(): MobileFidRegistrationFixtureSubject {
  const store = new FixtureEndpointStore();
  const controller = createMobileFidRegistrationController(
    store,
    new FixtureEndpointIdentity(),
    new FixtureClock(),
  );
  let restoredSession: MobileSessionScope | undefined;

  return {
    supportedRegistrationSurface: () =>
      controller.supportedRegistrationSurface(),
    evaluateEnvironment: (input) => controller.evaluateEnvironment(input),
    restoreSession: (session) => {
      restoredSession = { ...session };
      controller.restoreSession(session);
    },
    onRegistered: (input) => controller.onRegistered(input),
    onUnregistered: (input) => controller.onUnregistered(input),
    logoutCurrentInstallation: (fid) =>
      controller.logoutCurrentInstallation(fid),
    snapshot: async () => ({
      ...(restoredSession === undefined
        ? {}
        : { session: { ...restoredSession } }),
      endpoints: store.snapshotEndpoints(),
    }),
  };
}
