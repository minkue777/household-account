import {
  NOTIFICATION_PAYLOAD_VERSION,
  type NotificationTarget,
} from "../model/notificationTarget";

type NotificationPayloadV1 = NotificationTarget["payload"];

export type NotificationClickPayloadDecision =
  | { kind: "ValidPayload"; payload: NotificationPayloadV1 }
  | {
      kind: "Rejected";
      reason:
        | "INVALID_PAYLOAD"
        | "UNSUPPORTED_PAYLOAD_VERSION"
        | "UNSUPPORTED_CLICK_TARGET";
    };

const ALLOWED_PAYLOAD_KEYS = new Set([
  "payloadVersion",
  "type",
  "clickTarget",
  "expenseId",
]);
const MAX_EXPENSE_ID_LENGTH = 256;
const OPAQUE_EXPENSE_ID = /^[A-Za-z0-9._-]+$/;

export function validateNotificationClickPayload(
  payload: Readonly<Record<string, unknown>>,
): NotificationClickPayloadDecision {
  if (payload.payloadVersion !== NOTIFICATION_PAYLOAD_VERSION) {
    return { kind: "Rejected", reason: "UNSUPPORTED_PAYLOAD_VERSION" };
  }
  if (payload.clickTarget !== "expense-edit") {
    return { kind: "Rejected", reason: "UNSUPPORTED_CLICK_TARGET" };
  }
  if (Object.keys(payload).some((key) => !ALLOWED_PAYLOAD_KEYS.has(key))) {
    return { kind: "Rejected", reason: "INVALID_PAYLOAD" };
  }
  if (
    payload.type !== "expense-created" &&
    payload.type !== "household-notification-requested"
  ) {
    return { kind: "Rejected", reason: "INVALID_PAYLOAD" };
  }
  if (
    typeof payload.expenseId !== "string" ||
    payload.expenseId.length === 0 ||
    payload.expenseId.length > MAX_EXPENSE_ID_LENGTH ||
    !OPAQUE_EXPENSE_ID.test(payload.expenseId)
  ) {
    return { kind: "Rejected", reason: "INVALID_PAYLOAD" };
  }

  return {
    kind: "ValidPayload",
    payload: {
      payloadVersion: NOTIFICATION_PAYLOAD_VERSION,
      type: payload.type,
      clickTarget: "expense-edit",
      expenseId: payload.expenseId,
    },
  };
}
