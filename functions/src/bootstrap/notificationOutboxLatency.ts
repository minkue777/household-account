import type {
  DeliverNotificationResult,
} from "../contexts/notifications/application/ports/in/deliveryAssurancePort";
import type {
  ShortcutTransactionNotificationResult,
} from "../contexts/notifications/application/ports/in/shortcutTransactionNotificationPort";
import type {
  InteractiveLatencyStatus,
} from "../observability/interactiveLatency";

export const HOUSEHOLD_NOTIFICATION_DELIVERY_OPERATION =
  "notifications.deliver-household-request.v1";
export const SHORTCUT_NOTIFICATION_DELIVERY_OPERATION =
  "notifications.deliver-ios-shortcut.v1";

export function householdNotificationDeliveryLatencyStatus(
  result:
    | { readonly kind: "ExpiredEvent" }
    | { readonly kind: "NoTarget" }
    | {
        readonly kind: "Queued" | "AlreadyProcessed";
        readonly deliveryResults: readonly DeliverNotificationResult[];
      },
): InteractiveLatencyStatus {
  if (result.kind === "ExpiredEvent" || result.kind === "NoTarget") {
    return "rejected";
  }
  return result.deliveryResults.length > 0 &&
    result.deliveryResults.every(({ kind }) => kind === "Delivered")
    ? "succeeded"
    : "failed";
}

export function shortcutNotificationDeliveryLatencyStatus(
  result: ShortcutTransactionNotificationResult,
): InteractiveLatencyStatus {
  return result.kind === "Delivered" ? "succeeded" : "failed";
}
