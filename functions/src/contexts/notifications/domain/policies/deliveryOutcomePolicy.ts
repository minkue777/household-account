import type {
  ClassifiedDeliveryOutcome,
  DeliveryAggregateStatus,
  DeliveryTerminalStatus,
  NotificationProviderOutcome,
} from "../model/deliveryAssurance";

export function classifyProviderOutcome(
  outcome: NotificationProviderOutcome,
): ClassifiedDeliveryOutcome {
  switch (outcome.kind) {
    case "success":
      return { status: "delivered" };
    case "quota":
      return { status: "failed", errorCode: "PROVIDER_QUOTA" };
    case "network-error":
      return { status: "failed", errorCode: "PROVIDER_NETWORK_ERROR" };
    case "timeout":
      return {
        status: "unknown-provider-outcome",
        errorCode: "PROVIDER_TIMEOUT",
      };
    case "credential-error":
      return {
        status: "contract-failure",
        errorCode: "PROVIDER_CREDENTIAL_INVALID",
      };
    case "http-error":
      if (outcome.httpStatus === 404 && outcome.code === "UNREGISTERED") {
        return {
          status: "permanent-failure",
          errorCode: "FID_UNREGISTERED",
        };
      }
      if (outcome.httpStatus === 404) {
        return {
          status: "contract-failure",
          errorCode: "PROVIDER_RESPONSE_INVALID",
        };
      }
      return { status: "failed", errorCode: "PROVIDER_HTTP_ERROR" };
  }
}

export function aggregateDeliveryStatuses(
  statuses: readonly ("queued" | "sending" | DeliveryTerminalStatus)[],
): DeliveryAggregateStatus {
  if (statuses.length === 0) {
    return "no-target";
  }
  if (
    statuses.some((status) => status === "queued" || status === "sending")
  ) {
    return "queued";
  }

  const terminalStatuses = new Set(statuses as readonly DeliveryTerminalStatus[]);
  return terminalStatuses.size === 1
    ? (statuses[0] as DeliveryTerminalStatus)
    : "partial";
}
