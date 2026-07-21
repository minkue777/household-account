import { NOTIFICATION_PAYLOAD_VERSION } from "../model/notificationTarget";

export interface AndroidForegroundNotificationFact {
  androidApiLevel: number;
  postNotificationsPermission: "granted" | "denied" | "not-required";
  payloadVersion: string;
  notification?: {
    title: string;
    body: string;
  };
}

export type AndroidForegroundNotificationDecision =
  | { kind: "Display"; title: string; body: string }
  | {
      kind: "DoNotDisplay";
      reason:
        | "DATA_ONLY_PAYLOAD"
        | "POST_NOTIFICATIONS_PERMISSION_REQUIRED"
        | "UNSUPPORTED_PAYLOAD_VERSION";
    };

export function decideAndroidForegroundNotification(
  fact: AndroidForegroundNotificationFact,
): AndroidForegroundNotificationDecision {
  if (fact.payloadVersion !== NOTIFICATION_PAYLOAD_VERSION) {
    return {
      kind: "DoNotDisplay",
      reason: "UNSUPPORTED_PAYLOAD_VERSION",
    };
  }
  if (fact.notification === undefined) {
    return { kind: "DoNotDisplay", reason: "DATA_ONLY_PAYLOAD" };
  }
  if (
    fact.androidApiLevel >= 33 &&
    fact.postNotificationsPermission !== "granted"
  ) {
    return {
      kind: "DoNotDisplay",
      reason: "POST_NOTIFICATIONS_PERMISSION_REQUIRED",
    };
  }
  return {
    kind: "Display",
    title: fact.notification.title,
    body: fact.notification.body,
  };
}
