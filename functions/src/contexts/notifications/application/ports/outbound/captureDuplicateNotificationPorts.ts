import type { CaptureDuplicateObservedEvent } from "../in/captureDuplicateNotificationPort";

export type DuplicateNotificationPlatform =
  | "ios-pwa"
  | "android"
  | "desktop";

export interface DuplicateNotificationEndpointRecord {
  endpointId: string;
  householdId: string;
  memberId: string;
  platform: DuplicateNotificationPlatform;
  status: "active" | "inactive";
  fid: string;
}

export interface CaptureDuplicateInboxRecord {
  eventId: string;
  intentId: string;
  deliveryIds: readonly string[];
}

export type CaptureDuplicateIntentStatus =
  | "no-target"
  | "queued"
  | "delivered"
  | "failed";

export interface CaptureDuplicateIntentRecord {
  intentId: string;
  eventId: string;
  transactionId: string;
  recipientMemberId: string;
  status: CaptureDuplicateIntentStatus;
}

export type DuplicateDeliveryTerminalStatus =
  | "delivered"
  | "failed"
  | "unknown-provider-outcome"
  | "permanent-failure";

export type DuplicateDeliveryStatus =
  | "queued"
  | "sending"
  | DuplicateDeliveryTerminalStatus;

export interface CaptureDuplicateDeliveryRecord {
  deliveryId: string;
  intentId: string;
  eventId: string;
  endpointId: string;
  fid: string;
  status: DuplicateDeliveryStatus;
}

export interface CaptureDuplicateAcceptanceTransaction {
  readInbox(): Promise<CaptureDuplicateInboxRecord | null>;
  listEndpoints(): Promise<readonly DuplicateNotificationEndpointRecord[]>;
  saveInbox(record: CaptureDuplicateInboxRecord): Promise<void>;
  saveIntent(record: CaptureDuplicateIntentRecord): Promise<void>;
  saveDeliveries(
    records: readonly CaptureDuplicateDeliveryRecord[],
  ): Promise<void>;
}

export interface CaptureDuplicateDeliveryTransaction {
  readDelivery(): Promise<CaptureDuplicateDeliveryRecord | null>;
  saveDelivery(record: CaptureDuplicateDeliveryRecord): Promise<void>;
  readIntent(intentId: string): Promise<CaptureDuplicateIntentRecord | null>;
  saveIntent(record: CaptureDuplicateIntentRecord): Promise<void>;
  listIntentDeliveries(
    intentId: string,
  ): Promise<readonly CaptureDuplicateDeliveryRecord[]>;
}

export interface CaptureDuplicateNotificationStore {
  runAcceptance<T>(
    event: CaptureDuplicateObservedEvent,
    operation: (
      transaction: CaptureDuplicateAcceptanceTransaction,
    ) => Promise<T>,
  ): Promise<T>;
  runForDelivery<T>(
    deliveryId: string,
    operation: (
      transaction: CaptureDuplicateDeliveryTransaction,
    ) => Promise<T>,
  ): Promise<T>;
  waitForTerminalDelivery(
    deliveryId: string,
  ): Promise<DuplicateDeliveryTerminalStatus>;
}

export interface CaptureDuplicateNotificationProvider {
  sendOne(input: {
    deliveryId: string;
    endpointId: string;
    fid: string;
  }): Promise<DuplicateDeliveryTerminalStatus>;
}
