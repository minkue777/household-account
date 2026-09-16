export const HOUSEHOLD_NOTIFICATION_DELIVERY_OPERATION =
  "notifications.deliver-household-request.v1";
export const SHORTCUT_NOTIFICATION_DELIVERY_OPERATION =
  "notifications.deliver-ios-shortcut.v1";

export function notificationOutboxConsumerAlreadyTerminal(
  data: Readonly<Record<string, unknown>>,
): boolean {
  return [data.notificationConsumerProcessedAt, data.terminalAt].some(
    (value) => typeof value === "string" && value.trim() !== "",
  );
}
