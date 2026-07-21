import type { MobilePlatform } from "../../../domain/model/mobileNotificationEndpoint";

export interface Principal {
  uid: string;
  householdId: string;
  memberId: string;
}

export interface PublicEndpointView {
  endpointId: string;
  householdId: string;
  memberId: string;
  platform: MobilePlatform;
  status: "active" | "inactive";
  registrationVersion: number;
  bindingVersion: number;
}

export interface SecuredRegisterEndpointCommand {
  commandId: string;
  idempotencyKey: string;
  principal?: Principal;
  targetHouseholdId: string;
  targetMemberId: string;
  appAttestation: "valid" | "invalid" | "missing";
  fid: string;
  platform: string;
}

export type SecuredRegisterEndpointResult =
  | {
      kind: "EndpointRegistered";
      endpointId: string;
      result: "created" | "refreshed" | "stale-binding-recovered";
    }
  | { kind: "Unauthenticated"; code: "AUTH_REQUIRED" }
  | {
      kind: "Forbidden";
      code: "MEMBERSHIP_REQUIRED" | "APP_ATTESTATION_INVALID";
    }
  | {
      kind: "ValidationError";
      code: "FID_REQUIRED" | "MEMBER_ID_REQUIRED" | "PLATFORM_NOT_SUPPORTED";
    }
  | {
      kind: "Conflict";
      code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD";
    };

export interface SecuredRemoveEndpointInput {
  principal?: Principal;
  targetHouseholdId: string;
  targetMemberId: string;
  fid: string;
}

export type SecuredRemoveEndpointResult =
  | { kind: "Removed" }
  | { kind: "AlreadyAbsent" }
  | { kind: "Unauthenticated"; code: "AUTH_REQUIRED" }
  | { kind: "Forbidden"; code: "MEMBERSHIP_REQUIRED" }
  | { kind: "Conflict"; code: "ENDPOINT_BINDING_MISMATCH" };

export interface HouseholdMemberRemovedEvent {
  eventId: string;
  eventType: "HouseholdMemberRemoved.v1";
  producer: string;
  schemaVersion: number;
  householdId: string;
  memberId: string;
  systemCapability: "household-member-cleanup" | "invalid";
}

export type MemberCleanupResult =
  | { kind: "Completed"; removedEndpointCount: number }
  | { kind: "AlreadyProcessed"; removedEndpointCount: number }
  | {
      kind: "ContractFailure";
      code: "UNKNOWN_PRODUCER" | "UNSUPPORTED_EVENT_VERSION";
    }
  | { kind: "Forbidden"; code: "SYSTEM_CAPABILITY_REQUIRED" };

export interface ExplicitNotificationRequest {
  eventId: string;
  householdId: string;
  requesterMemberId: string;
  transactionId: string;
}

export type ExplicitRequestResult =
  | { kind: "Queued"; intentId: string; deliveryIds: readonly string[] }
  | { kind: "NoTarget" };

export interface TerminalDeliveryView {
  deliveryId: string;
  householdId: string;
  recipientMemberId: string;
  endpointId: string;
  status: "delivered" | "failed" | "stale-target";
  providerAttemptCount: 0 | 1;
}

export type HouseholdDeliveryStatusQueryResult =
  | { kind: "Success"; delivery: TerminalDeliveryView }
  | { kind: "NotFound" }
  | { kind: "Forbidden"; code: "HOUSEHOLD_ACCESS_DENIED" };

export interface NotificationsSecurityBoundaryInputPort {
  register(
    command: SecuredRegisterEndpointCommand,
  ): Promise<SecuredRegisterEndpointResult>;
  remove(
    input: SecuredRemoveEndpointInput,
  ): Promise<SecuredRemoveEndpointResult>;
  acceptExplicitRequest(
    event: ExplicitNotificationRequest,
  ): Promise<ExplicitRequestResult>;
  deliver(deliveryId: string): Promise<
    | { kind: "Delivered" }
    | { kind: "StaleTarget"; code: "RECIPIENT_MEMBERSHIP_INACTIVE" }
  >;
  getDeliveryStatus(input: {
    principal?: Principal;
    householdId: string;
    deliveryId: string;
  }): Promise<HouseholdDeliveryStatusQueryResult>;
  handleMemberRemoved(
    event: HouseholdMemberRemovedEvent,
  ): Promise<MemberCleanupResult>;
  listEndpointViews(
    householdId: string,
  ): Promise<readonly PublicEndpointView[]>;
  listTerminalDeliveries(
    householdId: string,
  ): Promise<readonly TerminalDeliveryView[]>;
}
