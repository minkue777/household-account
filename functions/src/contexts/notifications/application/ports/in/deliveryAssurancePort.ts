export interface HouseholdNotificationRequestedEvent {
  eventId: string;
  eventType: "HouseholdNotificationRequested.v1";
  producer: "household-finance.ledger";
  occurredAt: string;
  householdId: string;
  transactionId: string;
  requesterMemberId: string;
}

export type AcceptNotificationIntentResult =
  | { kind: "Queued"; intentId: string; deliveryIds: readonly string[] }
  | {
      kind: "AlreadyProcessed";
      intentId: string;
      deliveryIds: readonly string[];
    }
  | { kind: "NoTarget"; intentId: string }
  | {
      kind: "RetryableFailure";
      code: "MEMBERSHIP_LOOKUP_UNAVAILABLE";
    }
  | { kind: "ExpiredEvent" };

export type DeliverNotificationResult =
  | { kind: "Delivered" }
  | {
      kind: "Failed";
      code:
        | "PROVIDER_QUOTA"
        | "PROVIDER_HTTP_ERROR"
        | "PROVIDER_NETWORK_ERROR"
        | "MEMBERSHIP_CHECK_UNAVAILABLE";
    }
  | { kind: "UnknownProviderOutcome"; code: "PROVIDER_TIMEOUT" }
  | { kind: "PermanentFailure"; code: "FID_UNREGISTERED" }
  | {
      kind: "ContractFailure";
      code: "PROVIDER_CREDENTIAL_INVALID" | "PROVIDER_RESPONSE_INVALID";
    }
  | {
      kind: "StaleTarget";
      code: "ENDPOINT_CHANGED" | "RECIPIENT_MEMBERSHIP_INACTIVE";
    };

export interface DeliveryItemView {
  deliveryId: string;
  recipientMemberId: string;
  endpointId: string;
  status:
    | "queued"
    | "delivered"
    | "failed"
    | "unknown-provider-outcome"
    | "permanent-failure"
    | "contract-failure"
    | "stale-target";
  providerAttemptCount: 0 | 1;
  errorCode?: string;
  terminalAt?: string;
  expiresAt?: string;
}

export interface DeliveryStatusView {
  intentId: string;
  status:
    | "queued"
    | "delivered"
    | "partial"
    | "failed"
    | "unknown-provider-outcome"
    | "permanent-failure"
    | "contract-failure"
    | "stale-target"
    | "no-target";
  deliveries: readonly DeliveryItemView[];
}

export interface PublicEndpointStatusView {
  endpointId: string;
  status: "active" | "inactive";
  registrationVersion: number;
  bindingVersion: number;
}

export interface NotificationInboxStatusView {
  eventId: string;
  status: "accepted" | "retryable" | "terminal";
  code?: string;
  terminalAt?: string;
  expiresAt?: string;
}

export interface DeliveryAssuranceInputPort {
  accept(
    event: HouseholdNotificationRequestedEvent,
  ): Promise<AcceptNotificationIntentResult>;
  deliver(deliveryId: string): Promise<DeliverNotificationResult>;
  completeIntent(intentId: string): Promise<void>;
  getDeliveryStatus(
    intentId: string,
  ): Promise<DeliveryStatusView | undefined>;
  listDeliveryStatuses(
    householdId: string,
  ): Promise<readonly DeliveryStatusView[]>;
  listEndpointStatuses(
    householdId: string,
  ): Promise<readonly PublicEndpointStatusView[]>;
  getInboxStatus(
    eventId: string,
  ): Promise<NotificationInboxStatusView | undefined>;
  getTerminalRetentionDisposition(
    deliveryId: string,
    now: string,
  ): Promise<"retain" | "eligible-for-ttl-deletion">;
}
