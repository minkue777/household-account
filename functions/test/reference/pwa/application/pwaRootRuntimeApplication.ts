import type {
  PwaLogoutResult,
  PwaRootEndpointEvent,
  PwaRootRegistration,
  PwaRuntimeInitializationInput,
  PwaRuntimeInitializationResult,
} from "../domain/model/pwaRootRuntime";
import {
  isAllowedPwaNotificationDestination,
  isAllowedPwaPagePath,
  isAllowedPwaPublicAsset,
  isIntegratedRootRegistration,
  isPwaMessagingEligible,
  isValidIntegratedRootWorkerArtifact,
} from "../domain/policies/pwaRootRuntimePolicy";
import type { PwaRootRuntimeInputPort } from "./ports/in/pwaRootRuntimeInputPort";
import type {
  PwaMessagingEndpointPort,
  PwaProductionWorkerArtifactPort,
  PwaRootWorkerRegistrationPort,
  PwaSessionPurgePort,
  PwaWorkerVersionPort,
} from "./ports/out/pwaRootRuntimePorts";
import type { PwaSessionScopePort } from "./ports/out/pwaSessionScopePort";

interface BoundEndpoint {
  readonly fid: string;
  readonly memberId: string;
}

interface PendingCleanup {
  readonly fid?: string;
  readonly sessionGeneration?: string;
  endpointRemoved: boolean;
}

function copyRegistration(
  registration: PwaRootRegistration,
): PwaRootRegistration {
  return {
    registrationId: registration.registrationId,
    scope: registration.scope,
    scriptUrl: registration.scriptUrl,
    capabilities: [...registration.capabilities],
  };
}

export function createPwaRootRuntimeApplication(dependencies: {
  readonly artifact: PwaProductionWorkerArtifactPort;
  readonly registrations: PwaRootWorkerRegistrationPort;
  readonly endpoints: PwaMessagingEndpointPort;
  readonly sessions: PwaSessionPurgePort;
  readonly sessionScope: PwaSessionScopePort;
  readonly versions: PwaWorkerVersionPort;
  readonly origin: string;
  readonly publicAssetAllowlist: readonly string[];
}): PwaRootRuntimeInputPort {
  const retiredRegistrationIds: string[] = [];
  const messagingRegistrationIds: string[] = [];
  const endpointEvents: PwaRootEndpointEvent[] = [];
  let messagingPermissionRequested = false;
  let boundEndpoint: BoundEndpoint | undefined;
  let pendingCleanup: PendingCleanup | undefined;
  let pushEligible = false;
  let initializationInFlight:
    | Promise<PwaRuntimeInitializationResult>
    | undefined;

  const activeRegistration = (): PwaRootRegistration | undefined => {
    const registrations = dependencies.registrations.registrations();
    return registrations.length === 1 &&
      isIntegratedRootRegistration(registrations[0])
      ? registrations[0]
      : undefined;
  };

  const ensureIntegratedRegistration = async (): Promise<
    PwaRootRegistration | undefined
  > => {
    const existing = activeRegistration();
    if (existing !== undefined) return existing;

    const previous = dependencies.registrations.registrations();
    const result = await dependencies.registrations.registerIntegratedRootWorker();
    if (result.kind === "Failed") return undefined;

    for (const registration of previous) {
      if (registration.registrationId === result.registration.registrationId) {
        continue;
      }
      dependencies.registrations.retire(registration.registrationId);
      if (!retiredRegistrationIds.includes(registration.registrationId)) {
        retiredRegistrationIds.push(registration.registrationId);
      }
    }
    return result.registration;
  };

  const runInitialization = async (
    input: PwaRuntimeInitializationInput,
  ): Promise<PwaRuntimeInitializationResult> => {
    if (input.environment === "development") {
      return { kind: "DisabledInDevelopment" };
    }
    if (dependencies.sessionScope.snapshot().cleanupState !== "clean") {
      return { kind: "Failed", code: "PREVIOUS_SESSION_CLEANUP_REQUIRED" };
    }
    if (
      !isValidIntegratedRootWorkerArtifact(
        dependencies.artifact.workerArtifactPaths(),
      )
    ) {
      return { kind: "Failed", code: "WORKER_ARTIFACT_INVALID" };
    }

    const eligible = isPwaMessagingEligible(input);
    if (
      boundEndpoint !== undefined &&
      (!eligible ||
        boundEndpoint.fid !== input.fid ||
        boundEndpoint.memberId !== input.authenticatedMemberId)
    ) {
      return { kind: "Failed", code: "PREVIOUS_SESSION_CLEANUP_REQUIRED" };
    }

    const registration = await ensureIntegratedRegistration();
    if (registration === undefined) {
      return { kind: "Failed", code: "WORKER_REGISTRATION_FAILED" };
    }

    if (input.sessionGeneration === undefined) {
      dependencies.sessionScope.clear();
    } else {
      dependencies.sessionScope.open(input.sessionGeneration);
    }
    pushEligible = eligible;
    if (eligible) {
      messagingPermissionRequested = true;
      if (!messagingRegistrationIds.includes(registration.registrationId)) {
        messagingRegistrationIds.push(registration.registrationId);
      }
      if (boundEndpoint === undefined) {
        await dependencies.endpoints.register({
          fid: input.fid,
          memberId: input.authenticatedMemberId,
        });
        boundEndpoint = {
          fid: input.fid,
          memberId: input.authenticatedMemberId,
        };
        endpointEvents.push({
          kind: "Registered",
          fid: input.fid,
          memberId: input.authenticatedMemberId,
        });
      }
    }

    const versions = dependencies.versions.versions();
    if (
      versions.waitingWorkerVersion !== undefined &&
      versions.waitingWorkerVersion !== versions.activeWorkerVersion
    ) {
      return {
        kind: "UpdateAvailable",
        registrationId: registration.registrationId,
        activeWorkerVersion: versions.activeWorkerVersion,
        waitingWorkerVersion: versions.waitingWorkerVersion,
      };
    }
    return {
      kind: "Ready",
      registrationId: registration.registrationId,
      scope: "/",
    };
  };

  const initialize = (
    input: PwaRuntimeInitializationInput,
  ): Promise<PwaRuntimeInitializationResult> => {
    if (initializationInFlight !== undefined) return initializationInFlight;
    const current = runInitialization(input);
    const tracked = current.finally(() => {
      if (initializationInFlight === tracked) initializationInFlight = undefined;
    });
    initializationInFlight = tracked;
    return tracked;
  };

  const logout = async (): Promise<PwaLogoutResult> => {
    pushEligible = false;
    if (pendingCleanup === undefined) {
      pendingCleanup = {
        fid: boundEndpoint?.fid,
        sessionGeneration: dependencies.sessionScope.snapshot().generation,
        endpointRemoved: boundEndpoint === undefined,
      };
    }
    dependencies.sessionScope.beginCleanup();

    const removedFid = pendingCleanup.fid;
    if (removedFid !== undefined && !pendingCleanup.endpointRemoved) {
      const removal = await dependencies.endpoints.remove(removedFid);
      if (removal === "failure") {
        endpointEvents.push({ kind: "RemovalFailed", fid: removedFid });
        dependencies.sessionScope.isolate();
        return {
          kind: "FailedAndIsolated",
          code: "ENDPOINT_REMOVAL_FAILED",
          sessionGeneration: undefined,
        };
      }
      endpointEvents.push({ kind: "RemovalSucceeded", fid: removedFid });
      pendingCleanup.endpointRemoved = true;
    }

    const previousGeneration = pendingCleanup.sessionGeneration;
    if (previousGeneration !== undefined) {
      const purge = await dependencies.sessions.purge(previousGeneration);
      if (purge === "failure") {
        endpointEvents.push({
          kind: "SessionPurgeFailed",
          previousGeneration,
        });
        dependencies.sessionScope.isolate();
        return {
          kind: "FailedAndIsolated",
          code: "SESSION_PURGE_FAILED",
          sessionGeneration: undefined,
        };
      }
      endpointEvents.push({ kind: "SessionPurged", previousGeneration });
    }

    dependencies.sessionScope.clear();
    boundEndpoint = undefined;
    pendingCleanup = undefined;
    return removedFid === undefined
      ? { kind: "LoggedOut", sessionGeneration: undefined }
      : { kind: "LoggedOut", removedFid, sessionGeneration: undefined };
  };

  return {
    initialize,

    requestPage(path) {
      const registration = activeRegistration();
      return registration !== undefined && isAllowedPwaPagePath(path)
        ? { kind: "PageServed", registrationId: registration.registrationId }
        : { kind: "Unavailable" };
    },

    fetchPublicAsset(path) {
      const registration = activeRegistration();
      return registration !== undefined &&
        isAllowedPwaPublicAsset(path, dependencies.publicAssetAllowlist)
        ? {
            kind: "CacheServed",
            registrationId: registration.registrationId,
            path,
          }
        : { kind: "Unavailable" };
    },

    receiveBackgroundPush(notificationId) {
      const registration = activeRegistration();
      if (registration === undefined) return { kind: "WorkerUnavailable" };
      if (!pushEligible) return { kind: "NotSupportedForDevice" };
      return {
        kind: "Displayed",
        registrationId: registration.registrationId,
        notificationId,
      };
    },

    clickNotification(destination, existingClient) {
      const registration = activeRegistration();
      if (registration === undefined) {
        return { kind: "Rejected", code: "WORKER_UNAVAILABLE" };
      }
      if (
        !isAllowedPwaNotificationDestination({
          origin: dependencies.origin,
          destination,
        })
      ) {
        return { kind: "Rejected", code: "DESTINATION_NOT_ALLOWED" };
      }
      return {
        kind: existingClient ? "Focused" : "Opened",
        registrationId: registration.registrationId,
        destination,
      };
    },

    logout,

    state() {
      const scope = dependencies.sessionScope.snapshot();
      return {
        registrations: dependencies.registrations
          .registrations()
          .map(copyRegistration),
        retiredRegistrationIds: [...retiredRegistrationIds],
        messagingPermissionRequested,
        messagingRegistrationIds: [...messagingRegistrationIds],
        sessionGeneration: scope.generation,
        sessionCleanup: scope.cleanupState,
        endpointEvents: endpointEvents.map((event) => ({ ...event })),
      };
    },
  };
}
