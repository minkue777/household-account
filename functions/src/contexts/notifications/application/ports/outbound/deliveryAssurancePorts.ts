import type {
  DeliveryErrorCode,
  DeliveryTerminalStatus,
  NotificationProviderOutcome,
} from "../../../domain/model/deliveryAssurance";
import type { MobileNotificationEndpoint } from "../../../domain/model/mobileNotificationEndpoint";

export type DeliveryMembershipStatus = "active" | "removed" | "unavailable";

export interface DeliveryMembershipQueryPort {
  status(
    householdId: string,
    memberId: string,
  ): Promise<DeliveryMembershipStatus>;
}

export interface StoredDeliveryAssuranceInbox {
  eventId: string;
  status: "accepted" | "retryable" | "terminal";
  code?: string;
  intentId?: string;
  deliveryIds?: readonly string[];
  terminalAt?: string;
  expiresAt?: string;
}

export interface StoredDeliveryAssuranceIntent {
  intentId: string;
  eventId: string;
  householdId: string;
  status?: "pending" | "terminal";
  terminalAt?: string;
  expiresAt?: string;
}

export interface StoredAssuredDelivery {
  deliveryId: string;
  intentId: string;
  eventId: string;
  householdId: string;
  recipientMemberId: string;
  endpointId: string;
  expectedRegistrationVersion: number;
  expectedBindingVersion: number;
  status: "queued" | "sending" | DeliveryTerminalStatus;
  providerAttemptCount: 0 | 1;
  errorCode?: DeliveryErrorCode;
  terminalAt?: string;
  expiresAt?: string;
}

export interface DeliveryAcceptanceTransaction {
  readInbox(): Promise<StoredDeliveryAssuranceInbox | null>;
  saveInbox(record: StoredDeliveryAssuranceInbox): Promise<void>;
  saveIntent(record: StoredDeliveryAssuranceIntent): Promise<void>;
  saveDeliveries(records: readonly StoredAssuredDelivery[]): Promise<void>;
}

export interface AssuredDeliveryTransaction {
  readDelivery(): Promise<StoredAssuredDelivery | null>;
  saveDelivery(record: StoredAssuredDelivery): Promise<void>;
  readEndpoint(endpointId: string): Promise<MobileNotificationEndpoint | null>;
  saveEndpoint(endpoint: MobileNotificationEndpoint): Promise<void>;
}

export interface DeliveryAssuranceStore {
  readInbox(eventId: string): Promise<StoredDeliveryAssuranceInbox | null>;
  runAcceptance<T>(
    eventId: string,
    operation: (transaction: DeliveryAcceptanceTransaction) => Promise<T>,
  ): Promise<T>;
  listEndpoints(
    householdId: string,
  ): Promise<readonly MobileNotificationEndpoint[]>;
  runForDelivery<T>(
    deliveryId: string,
    operation: (transaction: AssuredDeliveryTransaction) => Promise<T>,
  ): Promise<T>;
  waitForTerminalDelivery(
    deliveryId: string,
  ): Promise<StoredAssuredDelivery>;
  readDelivery(deliveryId: string): Promise<StoredAssuredDelivery | null>;
  readIntent(
    intentId: string,
  ): Promise<StoredDeliveryAssuranceIntent | null>;
  listIntentDeliveries(
    intentId: string,
  ): Promise<readonly StoredAssuredDelivery[]>;
  listIntents(
    householdId: string,
  ): Promise<readonly StoredDeliveryAssuranceIntent[]>;
  completeIntent(input: {
    intentId: string;
    eventId: string;
    terminalAt: string;
    expiresAt: string;
  }): Promise<void>;
}

export interface DeliveryAssuranceProviderPort {
  sendOne(input: {
    deliveryId: string;
    endpointId: string;
    fid: string;
  }): Promise<NotificationProviderOutcome>;
}

export interface DeliveryAssuranceClock {
  now(): string;
}
