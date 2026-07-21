export type NotificationProviderOutcome =
  | { kind: "success" }
  | { kind: "http-error"; httpStatus: number; code: string }
  | { kind: "quota" }
  | { kind: "network-error" }
  | { kind: "timeout" }
  | { kind: "credential-error" };

export type DeliveryTerminalStatus =
  | "delivered"
  | "failed"
  | "unknown-provider-outcome"
  | "permanent-failure"
  | "contract-failure"
  | "stale-target";

export type DeliveryErrorCode =
  | "PROVIDER_QUOTA"
  | "PROVIDER_HTTP_ERROR"
  | "PROVIDER_NETWORK_ERROR"
  | "MEMBERSHIP_CHECK_UNAVAILABLE"
  | "PROVIDER_TIMEOUT"
  | "FID_UNREGISTERED"
  | "PROVIDER_CREDENTIAL_INVALID"
  | "PROVIDER_RESPONSE_INVALID"
  | "ENDPOINT_CHANGED"
  | "RECIPIENT_MEMBERSHIP_INACTIVE";

export interface ClassifiedDeliveryOutcome {
  status: DeliveryTerminalStatus;
  errorCode?: DeliveryErrorCode;
}

export type DeliveryAggregateStatus =
  | "queued"
  | DeliveryTerminalStatus
  | "partial"
  | "no-target";
