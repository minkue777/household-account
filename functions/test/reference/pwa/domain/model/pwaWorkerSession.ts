import type { PwaRootRegistration } from "./pwaRootRuntime";
import type { PwaSessionReadGate } from "./pwaSessionScope";

export interface PwaClientSnapshot {
  readonly clientId: string;
  readonly unsavedInput: string;
  readonly reloadCount: number;
  readonly visibleDataMarker?: string;
}

export interface PwaWorkerRuntimeState {
  readonly rootRegistration: PwaRootRegistration;
  readonly activeWorkerVersion: string;
  readonly activeCacheVersion: string;
  readonly waitingWorkerVersion?: string;
  readonly waitingCacheVersion?: string;
  readonly sessionGeneration?: string;
  readonly boundFid?: string;
  readonly clients: readonly PwaClientSnapshot[];
  readonly cacheNamespaces: readonly string[];
  readonly securityViolationCodes: readonly string[];
  readonly pendingRequestIds: readonly string[];
  readonly subscriptionIds: readonly string[];
  readonly pendingMessageIds: readonly string[];
  readonly sessionReadGate: PwaSessionReadGate;
}

export type WorkerUpdateOutcome =
  | { readonly kind: "Waiting"; readonly workerVersion: string }
  | { readonly kind: "InstallFailed"; readonly workerVersion: string }
  | {
      readonly kind: "DeferredForUnsavedInput";
      readonly workerVersion: string;
    }
  | {
      readonly kind: "Activated";
      readonly workerVersion: string;
      readonly reloadedClientId?: string;
    }
  | {
      readonly kind: "WaitingVersionMismatch";
      readonly expectedWorkerVersion: string;
      readonly actualWaitingWorkerVersion: string;
    }
  | { readonly kind: "NoWaitingWorker" };

export type SessionPurgeOutcome =
  | { readonly kind: "Purged"; readonly previousGeneration: string }
  | {
      readonly kind: "FailedAndIsolated";
      readonly previousGeneration: string;
    };

export type AsyncSessionResult =
  | { readonly kind: "Applied"; readonly marker: string }
  | { readonly kind: "DiscardedStaleGeneration" };

export type IncompatibleWriteOutcome = {
  readonly kind: "UpdateRequired";
  readonly inputPreserved: true;
  readonly reloadTriggered: false;
};

export type SessionReadAttempt =
  | { readonly kind: "Allowed"; readonly sessionGeneration: string }
  | {
      readonly kind: "Blocked";
      readonly reason:
        | "UNAUTHENTICATED"
        | "PREVIOUS_SESSION_CLEANUP_FAILED";
    };

export type PwaSessionTransitionInput =
  | {
      readonly purgeResult: "success" | "failure";
      readonly reason: "logout";
    }
  | {
      readonly nextGeneration: string;
      readonly purgeResult: "success" | "failure";
      readonly reason: "authenticated-user-change" | "household-change";
    };
