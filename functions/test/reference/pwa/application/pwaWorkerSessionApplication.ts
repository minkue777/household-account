import type {
  AsyncSessionResult,
  PwaClientSnapshot,
  PwaWorkerRuntimeState,
  SessionPurgeOutcome,
  WorkerUpdateOutcome,
} from "../domain/model/pwaWorkerSession";
import {
  canInstallPwaWorkerUpdate,
  isPwaOwnedStaticCache,
  isPwaSessionDerivedCache,
  pwaSessionReadGate,
  pwaStaticCacheNamespace,
} from "../domain/policies/pwaWorkerSessionPolicy";
import type { PwaWorkerSessionInputPort } from "./ports/in/pwaWorkerSessionInputPort";
import type { PwaSessionScopePort } from "./ports/out/pwaSessionScopePort";
import type { PwaRootWorkerIdentityPort } from "./ports/out/pwaWorkerSessionPorts";

interface MutableClientSnapshot {
  clientId: string;
  unsavedInput: string;
  reloadCount: number;
  visibleDataMarker?: string;
}

interface PendingAsyncRead {
  readonly clientId: string;
  readonly sessionGeneration: string;
}

interface WaitingWorker {
  readonly workerVersion: string;
  readonly cacheVersion: string;
  readonly cacheNamespace: string;
}

function copyClient(client: MutableClientSnapshot): PwaClientSnapshot {
  return {
    clientId: client.clientId,
    unsavedInput: client.unsavedInput,
    reloadCount: client.reloadCount,
    visibleDataMarker: client.visibleDataMarker,
  };
}

export function createPwaWorkerSessionApplication(dependencies: {
  readonly rootWorker: PwaRootWorkerIdentityPort;
  readonly sessionScope: PwaSessionScopePort;
  readonly initialState: {
    readonly activeWorkerVersion: string;
    readonly activeCacheVersion: string;
    readonly boundFid?: string;
    readonly clients: readonly Pick<
      PwaClientSnapshot,
      "clientId" | "unsavedInput" | "visibleDataMarker"
    >[];
    readonly cacheNamespaces: readonly string[];
    readonly subscriptionIds: readonly string[];
    readonly pendingMessageIds: readonly string[];
  };
}): PwaWorkerSessionInputPort {
  let activeWorkerVersion = dependencies.initialState.activeWorkerVersion;
  let activeCacheVersion = dependencies.initialState.activeCacheVersion;
  let waitingWorker: WaitingWorker | undefined;
  let boundFid = dependencies.initialState.boundFid;
  let callbackSequence = 1;
  let subscriptionSequence = 1;
  const clients = new Map<string, MutableClientSnapshot>();
  for (const client of dependencies.initialState.clients) {
    clients.set(client.clientId, { ...client, reloadCount: 0 });
  }
  let cacheNamespaces = [...dependencies.initialState.cacheNamespaces];
  const securityViolationCodes: string[] = [];
  const pendingReads = new Map<string, PendingAsyncRead>();
  let subscriptionIds = [...dependencies.initialState.subscriptionIds];
  let pendingMessageIds = [...dependencies.initialState.pendingMessageIds];

  const activateWaitingWorker = (
    reloadedClientId?: string,
  ): WorkerUpdateOutcome => {
    if (waitingWorker === undefined) return { kind: "NoWaitingWorker" };
    const activated = waitingWorker;
    activeWorkerVersion = activated.workerVersion;
    activeCacheVersion = activated.cacheVersion;
    cacheNamespaces = cacheNamespaces.filter(
      (namespace) =>
        !isPwaOwnedStaticCache(namespace) ||
        namespace === activated.cacheNamespace,
    );
    if (!cacheNamespaces.includes(activated.cacheNamespace)) {
      cacheNamespaces.push(activated.cacheNamespace);
    }
    waitingWorker = undefined;

    if (reloadedClientId !== undefined) {
      const client = clients.get(reloadedClientId);
      if (client !== undefined) client.reloadCount += 1;
    }
    return reloadedClientId === undefined
      ? { kind: "Activated", workerVersion: activated.workerVersion }
      : {
          kind: "Activated",
          workerVersion: activated.workerVersion,
          reloadedClientId,
        };
  };

  const purgeSessionState = (): void => {
    for (const client of clients.values()) client.visibleDataMarker = undefined;
    pendingReads.clear();
    subscriptionIds = [];
    pendingMessageIds = [];
    boundFid = undefined;
    const sessionCaches = cacheNamespaces.filter(isPwaSessionDerivedCache);
    if (
      sessionCaches.length > 0 &&
      !securityViolationCodes.includes("SESSION_DERIVED_CACHE_FOUND")
    ) {
      securityViolationCodes.push("SESSION_DERIVED_CACHE_FOUND");
    }
    cacheNamespaces = cacheNamespaces.filter(
      (namespace) => !isPwaSessionDerivedCache(namespace),
    );
  };

  return {
    async discoverWorker(input): Promise<WorkerUpdateOutcome> {
      const rootRegistration = dependencies.rootWorker.currentRootRegistration();
      if (
        !canInstallPwaWorkerUpdate(
          rootRegistration,
          input.requiredAssetsPrepared,
        )
      ) {
        if (input.candidateCacheNamespace !== undefined) {
          cacheNamespaces = cacheNamespaces.filter(
            (namespace) => namespace !== input.candidateCacheNamespace,
          );
        }
        return { kind: "InstallFailed", workerVersion: input.workerVersion };
      }

      const cacheNamespace = pwaStaticCacheNamespace(input.cacheVersion);
      if (waitingWorker !== undefined) {
        cacheNamespaces = cacheNamespaces.filter(
          (namespace) => namespace !== waitingWorker?.cacheNamespace,
        );
      }
      waitingWorker = {
        workerVersion: input.workerVersion,
        cacheVersion: input.cacheVersion,
        cacheNamespace,
      };
      if (!cacheNamespaces.includes(cacheNamespace)) {
        cacheNamespaces.push(cacheNamespace);
      }
      return { kind: "Waiting", workerVersion: input.workerVersion };
    },

    async requestRefresh(
      clientId,
      expectedWaitingWorkerVersion,
    ): Promise<WorkerUpdateOutcome> {
      if (waitingWorker === undefined) return { kind: "NoWaitingWorker" };
      if (waitingWorker.workerVersion !== expectedWaitingWorkerVersion) {
        return {
          kind: "WaitingVersionMismatch",
          expectedWorkerVersion: expectedWaitingWorkerVersion,
          actualWaitingWorkerVersion: waitingWorker.workerVersion,
        };
      }
      const client = clients.get(clientId);
      if (client !== undefined && client.unsavedInput !== "") {
        return {
          kind: "DeferredForUnsavedInput",
          workerVersion: waitingWorker.workerVersion,
        };
      }
      return activateWaitingWorker(clientId);
    },

    elapseWithoutUserAction(): WorkerUpdateOutcome {
      return waitingWorker === undefined
        ? { kind: "NoWaitingWorker" }
        : { kind: "Waiting", workerVersion: waitingWorker.workerVersion };
    },

    updateClientInput(clientId, unsavedInput): void {
      const client = clients.get(clientId);
      if (client !== undefined) client.unsavedInput = unsavedInput;
    },

    async closeClient(clientId): Promise<WorkerUpdateOutcome> {
      clients.delete(clientId);
      if (clients.size === 0) return activateWaitingWorker();
      return waitingWorker === undefined
        ? { kind: "NoWaitingWorker" }
        : { kind: "Waiting", workerVersion: waitingWorker.workerVersion };
    },

    reopenClient(clientId): void {
      clients.set(clientId, {
        clientId,
        unsavedInput: "",
        reloadCount: 0,
      });
    },

    beginAsyncRead(clientId) {
      const capturedGeneration =
        dependencies.sessionScope.snapshot().generation ?? "";
      const callbackId = `callback-${callbackSequence}`;
      callbackSequence += 1;
      pendingReads.set(callbackId, {
        clientId,
        sessionGeneration: capturedGeneration,
      });
      return { callbackId, sessionGeneration: capturedGeneration };
    },

    subscribe() {
      const capturedGeneration =
        dependencies.sessionScope.snapshot().generation ?? "";
      const subscriptionId = `subscription-${subscriptionSequence}`;
      subscriptionSequence += 1;
      subscriptionIds.push(subscriptionId);
      return { subscriptionId, sessionGeneration: capturedGeneration };
    },

    async transitionSession(input): Promise<SessionPurgeOutcome> {
      const previousGeneration =
        dependencies.sessionScope.snapshot().generation ?? "";
      dependencies.sessionScope.beginCleanup();
      purgeSessionState();
      if (input.purgeResult === "failure") {
        dependencies.sessionScope.isolate();
        return { kind: "FailedAndIsolated", previousGeneration };
      }

      if (input.reason === "logout") dependencies.sessionScope.clear();
      else dependencies.sessionScope.open(input.nextGeneration);
      return { kind: "Purged", previousGeneration };
    },

    attemptSessionRead() {
      const scope = dependencies.sessionScope.snapshot();
      const gate = pwaSessionReadGate({
        sessionGeneration: scope.generation,
        cleanupState: scope.cleanupState,
      });
      if (gate === "blocked-cleanup-failed") {
        return {
          kind: "Blocked",
          reason: "PREVIOUS_SESSION_CLEANUP_FAILED",
        };
      }
      if (scope.generation === undefined) {
        return { kind: "Blocked", reason: "UNAUTHENTICATED" };
      }
      return { kind: "Allowed", sessionGeneration: scope.generation };
    },

    completeAsyncRead(input): AsyncSessionResult {
      const pending = pendingReads.get(input.callbackId);
      pendingReads.delete(input.callbackId);
      const scope = dependencies.sessionScope.snapshot();
      if (
        pending === undefined ||
        scope.cleanupState !== "clean" ||
        scope.generation === undefined ||
        pending.sessionGeneration !== input.capturedGeneration ||
        input.capturedGeneration !== scope.generation
      ) {
        return { kind: "DiscardedStaleGeneration" };
      }
      const client = clients.get(pending.clientId);
      if (client === undefined) return { kind: "DiscardedStaleGeneration" };
      client.visibleDataMarker = input.marker;
      return { kind: "Applied", marker: input.marker };
    },

    handleIncompatibleWrite() {
      return {
        kind: "UpdateRequired",
        inputPreserved: true,
        reloadTriggered: false,
      };
    },

    state(): PwaWorkerRuntimeState {
      const rootRegistration = dependencies.rootWorker.currentRootRegistration();
      const scope = dependencies.sessionScope.snapshot();
      return {
        rootRegistration: {
          ...rootRegistration,
          capabilities: [...rootRegistration.capabilities],
        },
        activeWorkerVersion,
        activeCacheVersion,
        waitingWorkerVersion: waitingWorker?.workerVersion,
        waitingCacheVersion: waitingWorker?.cacheVersion,
        sessionGeneration: scope.generation,
        boundFid,
        clients: [...clients.values()].map(copyClient),
        cacheNamespaces: [...cacheNamespaces],
        securityViolationCodes: [...securityViolationCodes],
        pendingRequestIds: [...pendingReads.keys()],
        subscriptionIds: [...subscriptionIds],
        pendingMessageIds: [...pendingMessageIds],
        sessionReadGate: pwaSessionReadGate({
          sessionGeneration: scope.generation,
          cleanupState: scope.cleanupState,
        }),
      };
    },
  };
}
