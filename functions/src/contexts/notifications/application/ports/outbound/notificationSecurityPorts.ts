import type { SecuredRegisterEndpointResult } from "../in/notificationSecurityBoundaryPort";
import type { MobileNotificationEndpoint } from "../../../domain/model/mobileNotificationEndpoint";

export type MembershipStatus = "active" | "removed" | "missing";

export interface NotificationMembershipQueryPort {
  status(householdId: string, memberId: string): MembershipStatus;
}

export interface SecuredRegistrationReceipt {
  idempotencyKey: string;
  payloadFingerprint: string;
  result: Extract<
    SecuredRegisterEndpointResult,
    { kind: "EndpointRegistered" }
  >;
}

export interface SecuredEndpointTransaction {
  readEndpoint(): Promise<MobileNotificationEndpoint | null>;
  saveEndpoint(endpoint: MobileNotificationEndpoint): Promise<void>;
  removeEndpoint(): Promise<void>;
  readRegistrationReceipt(
    idempotencyKey: string,
  ): Promise<SecuredRegistrationReceipt | null>;
  saveRegistrationReceipt(receipt: SecuredRegistrationReceipt): Promise<void>;
}

export interface StoredSecurityDelivery {
  deliveryId: string;
  householdId: string;
  recipientMemberId: string;
  endpointId: string;
  status: "queued" | "delivered" | "failed" | "stale-target";
  providerAttemptCount: 0 | 1;
}

export interface MemberCleanupStoreResult {
  replayed: boolean;
  removedEndpointCount: number;
}

export interface NotificationSecurityStore {
  runEndpointCommand<T>(
    commandId: string | undefined,
    endpointId: string,
    operation: (transaction: SecuredEndpointTransaction) => Promise<T>,
  ): Promise<T>;
  listEndpoints(
    householdId: string,
  ): Promise<readonly MobileNotificationEndpoint[]>;
  cleanupMemberEndpoints(
    eventId: string,
    householdId: string,
    memberId: string,
  ): Promise<MemberCleanupStoreResult>;
  saveDeliveries(deliveries: readonly StoredSecurityDelivery[]): Promise<void>;
  readDelivery(deliveryId: string): Promise<StoredSecurityDelivery | null>;
  saveDelivery(delivery: StoredSecurityDelivery): Promise<void>;
  listDeliveries(
    householdId: string,
  ): Promise<readonly StoredSecurityDelivery[]>;
}

export interface SafeNotificationObservabilityPort {
  record(input: {
    name: string;
    endpointId?: string;
    resultCode: string;
  }): void;
}

export interface NotificationSecurityClock {
  now(): string;
}
