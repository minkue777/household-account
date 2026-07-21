import type { PwaSessionCleanupState } from "./pwaSessionScope";

export type PwaRootWorkerCapability =
  | "page"
  | "cache"
  | "push"
  | "notification-click";

export interface PwaRootRegistration {
  readonly registrationId: string;
  readonly scope: "/";
  readonly scriptUrl: "/sw.js" | "/firebase-messaging-sw.js";
  readonly capabilities: readonly PwaRootWorkerCapability[];
}

export interface PwaRuntimeInitializationInput {
  readonly environment: "development" | "production";
  readonly displayMode: "browser" | "standalone";
  readonly deviceClass: "iphone-home-pwa" | "desktop";
  readonly authenticatedMemberId?: string;
  readonly fid?: string;
  readonly sessionGeneration?: string;
}

export type PwaRuntimeInitializationResult =
  | { readonly kind: "DisabledInDevelopment" }
  | { readonly kind: "Ready"; readonly registrationId: string; readonly scope: "/" }
  | {
      readonly kind: "UpdateAvailable";
      readonly registrationId: string;
      readonly activeWorkerVersion: string;
      readonly waitingWorkerVersion: string;
    }
  | {
      readonly kind: "Failed";
      readonly code:
        | "WORKER_ARTIFACT_INVALID"
        | "WORKER_REGISTRATION_FAILED"
        | "PREVIOUS_SESSION_CLEANUP_REQUIRED";
    };

export type PwaPageResult =
  | { readonly kind: "PageServed"; readonly registrationId: string }
  | { readonly kind: "Unavailable" };

export type PwaPublicAssetResult =
  | {
      readonly kind: "CacheServed";
      readonly registrationId: string;
      readonly path: string;
    }
  | { readonly kind: "Unavailable" };

export type PwaPushResult =
  | {
      readonly kind: "Displayed";
      readonly registrationId: string;
      readonly notificationId: string;
    }
  | { readonly kind: "NotSupportedForDevice" }
  | { readonly kind: "WorkerUnavailable" };

export type PwaClickResult =
  | {
      readonly kind: "Focused" | "Opened";
      readonly registrationId: string;
      readonly destination: string;
    }
  | {
      readonly kind: "Rejected";
      readonly code: "DESTINATION_NOT_ALLOWED" | "WORKER_UNAVAILABLE";
    };

export type PwaLogoutResult =
  | {
      readonly kind: "LoggedOut";
      readonly removedFid?: string;
      readonly sessionGeneration?: undefined;
    }
  | {
      readonly kind: "FailedAndIsolated";
      readonly code: "ENDPOINT_REMOVAL_FAILED" | "SESSION_PURGE_FAILED";
      readonly sessionGeneration?: undefined;
    };

export type PwaRootEndpointEvent =
  | { readonly kind: "Registered"; readonly fid: string; readonly memberId: string }
  | { readonly kind: "RemovalSucceeded"; readonly fid: string }
  | { readonly kind: "RemovalFailed"; readonly fid: string }
  | { readonly kind: "SessionPurged"; readonly previousGeneration: string }
  | { readonly kind: "SessionPurgeFailed"; readonly previousGeneration: string };

export interface PwaRootRuntimeState {
  readonly registrations: readonly PwaRootRegistration[];
  readonly retiredRegistrationIds: readonly string[];
  readonly messagingPermissionRequested: boolean;
  readonly messagingRegistrationIds: readonly string[];
  readonly sessionGeneration?: string;
  readonly sessionCleanup: PwaSessionCleanupState;
  readonly endpointEvents: readonly PwaRootEndpointEvent[];
}
