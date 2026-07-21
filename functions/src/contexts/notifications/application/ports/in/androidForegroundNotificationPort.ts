import type { NotificationSettingsSnapshot } from "./notificationSettingsIndependencePort";

export interface AndroidForegroundPayload {
  payloadVersion: string;
  notification?: {
    title: string;
    body: string;
  };
  data?: Readonly<Record<string, string>>;
}

export type AndroidPostNotificationsPermission =
  | NotificationSettingsSnapshot["osNotificationPermission"]
  | "not-required";

export type AndroidForegroundResult =
  | {
      kind: "displayed";
      notificationId: number;
      channel: {
        id: "expense_notifications";
        name: "지출 알림";
        importance: "default";
      };
      contentIntent: { activity: "MainActivity" };
    }
  | {
      kind: "not-displayed";
      reason:
        | "DATA_ONLY_PAYLOAD"
        | "POST_NOTIFICATIONS_PERMISSION_REQUIRED"
        | "UNSUPPORTED_PAYLOAD_VERSION";
    };

export interface AndroidForegroundNotificationInputPort {
  receive(input: {
    androidApiLevel: number;
    postNotificationsPermission: AndroidPostNotificationsPermission;
    payload: AndroidForegroundPayload;
  }): Promise<AndroidForegroundResult>;
}
