import { createPwaWorkerSessionApplication } from "../reference/pwa/application/pwaWorkerSessionApplication";
import type { PwaRootWorkerIdentityPort } from "../reference/pwa/application/ports/out/pwaWorkerSessionPorts";
import { InMemoryPwaSessionScope } from "./pwa-session-scope-fake";
import type {
  PwaClientSnapshot,
  PwaRootRegistration,
  PwaWorkerSessionInputPort,
} from "../reference/pwa/public";

export type {
  AsyncSessionResult,
  IncompatibleWriteOutcome,
  PwaClientSnapshot,
  PwaWorkerRuntimeState,
  SessionPurgeOutcome,
  SessionReadAttempt,
  WorkerUpdateOutcome,
} from "../reference/pwa/public";

export interface PwaWorkerSessionFixture {
  readonly rootRegistration?: PwaRootRegistration;
  readonly activeWorkerVersion?: string;
  readonly activeCacheVersion?: string;
  readonly sessionGeneration?: string;
  readonly boundFid?: string;
  readonly clients?: readonly Pick<
    PwaClientSnapshot,
    "clientId" | "unsavedInput" | "visibleDataMarker"
  >[];
  readonly cacheNamespaces?: readonly string[];
  readonly subscriptionIds?: readonly string[];
  readonly pendingMessageIds?: readonly string[];
}

export interface PwaWorkerSessionDriver extends PwaWorkerSessionInputPort {}

const defaultRootRegistration: PwaRootRegistration = {
  registrationId: "pwa-root-registration-1",
  scope: "/",
  scriptUrl: "/sw.js",
  capabilities: ["page", "cache", "push", "notification-click"],
};

export function createPwaWorkerSessionDriver(
  fixture: PwaWorkerSessionFixture = {},
): PwaWorkerSessionDriver {
  const configuredRoot = fixture.rootRegistration ?? defaultRootRegistration;
  const rootWorker: PwaRootWorkerIdentityPort = {
    currentRootRegistration: () => ({
      ...configuredRoot,
      capabilities: [...configuredRoot.capabilities],
    }),
  };

  return createPwaWorkerSessionApplication({
    rootWorker,
    sessionScope: new InMemoryPwaSessionScope(fixture.sessionGeneration),
    initialState: {
      activeWorkerVersion: fixture.activeWorkerVersion ?? "worker-v1",
      activeCacheVersion: fixture.activeCacheVersion ?? "cache-v1",
      boundFid: fixture.boundFid,
      clients: fixture.clients ?? [],
      cacheNamespaces: fixture.cacheNamespaces ?? [],
      subscriptionIds: fixture.subscriptionIds ?? [],
      pendingMessageIds: fixture.pendingMessageIds ?? [],
    },
  });
}
