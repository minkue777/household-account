import { createPwaRootRuntimeApplication } from "../reference/pwa/application/pwaRootRuntimeApplication";
import type {
  PwaMessagingEndpointPort,
  PwaProductionWorkerArtifactPort,
  PwaRootWorkerRegistrationPort,
  PwaSessionPurgePort,
  PwaWorkerVersionPort,
} from "../reference/pwa/application/ports/out/pwaRootRuntimePorts";
import type {
  PwaRootRegistration,
  PwaRootRuntimeInputPort,
} from "../reference/pwa/public";
import { InMemoryPwaSessionScope } from "./pwa-session-scope-fake";

export type {
  PwaClickResult,
  PwaLogoutResult,
  PwaPageResult,
  PwaPublicAssetResult,
  PwaPushResult,
  PwaRootRegistration,
  PwaRootRuntimeState,
  PwaRuntimeInitializationResult,
} from "../reference/pwa/public";

export interface PwaRootRuntimeFixture {
  readonly initialRegistrations?: readonly PwaRootRegistration[];
  readonly workerArtifactPaths?: readonly string[];
  readonly workerRegistrationResult?: "success" | "failure";
  readonly activeWorkerVersion?: string;
  readonly waitingWorkerVersion?: string;
  readonly endpointRemovalResults?: readonly ("success" | "failure")[];
  readonly sessionPurgeResults?: readonly ("success" | "failure")[];
  readonly publicAssetAllowlist?: readonly string[];
  readonly origin?: string;
}

export interface PwaRootRuntimeDriver extends PwaRootRuntimeInputPort {}

class InMemoryRootWorkerRegistrations
  implements PwaRootWorkerRegistrationPort
{
  private readonly values = new Map<string, PwaRootRegistration>();
  private nextId = 1;

  constructor(
    initial: readonly PwaRootRegistration[],
    private readonly registrationResult: "success" | "failure",
  ) {
    for (const registration of initial) {
      this.values.set(registration.registrationId, {
        ...registration,
        capabilities: [...registration.capabilities],
      });
    }
  }

  registrations(): readonly PwaRootRegistration[] {
    return [...this.values.values()].map((registration) => ({
      ...registration,
      capabilities: [...registration.capabilities],
    }));
  }

  async registerIntegratedRootWorker() {
    if (this.registrationResult === "failure") {
      return { kind: "Failed" as const };
    }
    const registration: PwaRootRegistration = {
      registrationId: `pwa-root-registration-${this.nextId}`,
      scope: "/",
      scriptUrl: "/sw.js",
      capabilities: ["page", "cache", "push", "notification-click"],
    };
    this.nextId += 1;
    this.values.set(registration.registrationId, registration);
    return { kind: "Registered" as const, registration };
  }

  retire(registrationId: string): void {
    this.values.delete(registrationId);
  }
}

function queuedResult<T>(values: readonly T[] | undefined, fallback: T): () => T {
  const queue = [...(values ?? [])];
  return () => queue.shift() ?? fallback;
}

export function createPwaRootRuntimeDriver(
  fixture: PwaRootRuntimeFixture = {},
): PwaRootRuntimeDriver {
  const artifactPaths = [...(fixture.workerArtifactPaths ?? ["/sw.js"])];
  const artifact: PwaProductionWorkerArtifactPort = {
    workerArtifactPaths: () => [...artifactPaths],
  };
  const registrations = new InMemoryRootWorkerRegistrations(
    fixture.initialRegistrations ?? [],
    fixture.workerRegistrationResult ?? "success",
  );
  const nextEndpointRemoval = queuedResult(
    fixture.endpointRemovalResults,
    "success" as const,
  );
  const endpoints: PwaMessagingEndpointPort = {
    register: async () => undefined,
    remove: async () => nextEndpointRemoval(),
  };
  const nextSessionPurge = queuedResult(
    fixture.sessionPurgeResults,
    "success" as const,
  );
  const sessions: PwaSessionPurgePort = {
    purge: async () => nextSessionPurge(),
  };
  const versions: PwaWorkerVersionPort = {
    versions: () => ({
      activeWorkerVersion: fixture.activeWorkerVersion ?? "worker-v1",
      waitingWorkerVersion: fixture.waitingWorkerVersion,
    }),
  };

  return createPwaRootRuntimeApplication({
    artifact,
    registrations,
    endpoints,
    sessions,
    sessionScope: new InMemoryPwaSessionScope(),
    versions,
    origin: fixture.origin ?? "https://household.example",
    publicAssetAllowlist: fixture.publicAssetAllowlist ?? [
      "/icons/icon-192.png",
      "/fonts/app.woff2",
      "/images/brand.webp",
    ],
  });
}
