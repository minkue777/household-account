import type {
  MobileEndpointDeviceInfo,
  MobilePlatform,
} from "../../../domain/model/mobileNotificationEndpoint";
import type { EndpointInactivationObservation } from "../../../domain/policies/endpointInactivationPolicy";

export type MobileEndpointPlatform = MobilePlatform;

export interface EndpointView {
  endpointId: string;
  householdId: string;
  memberId: string;
  platform: MobileEndpointPlatform;
  status: "active" | "inactive";
  registrationVersion: number;
  bindingVersion: number;
  lastConfirmedAt: string;
  inactiveAt?: string;
  expiresAt?: string;
}

export interface EndpointActor {
  uid: string;
  householdId: string;
  memberId: string;
}

export interface RegisterEndpointCommand {
  commandId: string;
  idempotencyKey: string;
  actor: EndpointActor;
  appAttestation: "valid";
  fid: string;
  platform: MobileEndpointPlatform;
  now: string;
  deviceInfo?: Pick<
    MobileEndpointDeviceInfo,
    "model" | "osVersion" | "appVersion"
  >;
}

export type RegisterEndpointResult =
  | {
      kind: "EndpointRegistered";
      endpointId: string;
      result: "created" | "refreshed" | "stale-binding-recovered";
      registrationVersion: number;
    }
  | {
      kind: "Conflict";
      code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD";
    };

export interface RemoveEndpointCommand {
  commandId: string;
  idempotencyKey: string;
  actor: EndpointActor;
  fid: string;
}

export type RemoveEndpointResult =
  | { kind: "Removed"; endpointId: string }
  | { kind: "AlreadyAbsent" }
  | { kind: "Conflict"; code: "ENDPOINT_BINDING_MISMATCH" };

export interface MarkEndpointInactiveCommand {
  endpointId: string;
  expectedRegistrationVersion: number;
  expectedBindingVersion: number;
  now: string;
  observation: EndpointInactivationObservation;
}

export type MarkEndpointInactiveResult =
  | { kind: "Inactivated" }
  | { kind: "StaleIgnored" }
  | { kind: "NotPermanentFailure" };

export type EndpointClientCapabilityResult =
  | { kind: "Eligible"; platform: MobileEndpointPlatform }
  | {
      kind: "NotEligible";
      reason: "DESKTOP_NOT_SUPPORTED" | "IOS_PERMISSION_REQUIRED";
    };

export interface EndpointLifecycleInputPort {
  evaluateClientCapability(input: {
    runtime: "android-app" | "ios-home-screen-pwa" | "desktop-web";
    osNotificationPermission: "granted" | "denied";
  }): EndpointClientCapabilityResult;
  register(command: RegisterEndpointCommand): Promise<RegisterEndpointResult>;
  remove(command: RemoveEndpointCommand): Promise<RemoveEndpointResult>;
  markInactive(
    command: MarkEndpointInactiveCommand,
  ): Promise<MarkEndpointInactiveResult>;
  listEndpointViews(householdId: string): Promise<readonly EndpointView[]>;
}
