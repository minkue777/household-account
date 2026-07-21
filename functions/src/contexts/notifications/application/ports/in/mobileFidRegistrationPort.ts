import type {
  MobileEndpointDeviceInfo,
  MobilePlatform,
  MobileRuntime,
} from "../../../domain/model/mobileNotificationEndpoint";

export type { MobileEndpointDeviceInfo, MobilePlatform, MobileRuntime };

export interface MobileSessionScope {
  principalUid: string;
  householdId: string;
  memberId: string;
  sessionGeneration: number;
}

export type ClientCapabilityResult =
  | {
      kind: "eligible";
      platform: MobilePlatform;
      registrationMechanism: "firebase-installation-id";
    }
  | {
      kind: "not-eligible";
      reason:
        | "IOS_HOME_SCREEN_INSTALL_REQUIRED"
        | "IOS_NOTIFICATION_PERMISSION_REQUIRED"
        | "DESKTOP_NOT_SUPPORTED";
    };

export type ClientEndpointResult =
  | {
      kind: "registered";
      endpointId: string;
      registrationVersion: number;
      result: "created" | "refreshed" | "stale-binding-recovered";
    }
  | { kind: "removed"; endpointId: string }
  | { kind: "already-absent" }
  | { kind: "inactivated"; endpointId: string }
  | { kind: "stale-ignored"; endpointId: string }
  | {
      kind: "ignored";
      reason: "SESSION_REQUIRED" | "RUNTIME_NOT_ELIGIBLE";
    }
  | { kind: "validation-error"; code: "FID_REQUIRED" };

export interface RegisterMobileFidInput {
  runtime: MobileRuntime;
  osNotificationPermission: "granted" | "denied";
  fid: string;
  deviceInfo: MobileEndpointDeviceInfo;
}

export interface UnregisterMobileFidInput {
  fid: string;
  expectedRegistrationVersion: number;
}

export interface MobileFidRegistrationInputPort {
  supportedRegistrationSurface(): readonly string[];
  evaluateEnvironment(input: {
    runtime: MobileRuntime;
    osNotificationPermission: "granted" | "denied";
  }): ClientCapabilityResult;
  restoreSession(session: MobileSessionScope): void;
  onRegistered(input: RegisterMobileFidInput): Promise<ClientEndpointResult>;
  onUnregistered(
    input: UnregisterMobileFidInput,
  ): Promise<ClientEndpointResult>;
  logoutCurrentInstallation(fid: string): Promise<ClientEndpointResult>;
}
