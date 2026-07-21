import type {
  AndroidForegroundNotificationInputPort,
  AndroidForegroundResult,
} from "./ports/in/androidForegroundNotificationPort";
import type {
  AndroidNotificationIdPort,
  AndroidSystemNotificationPort,
} from "./ports/outbound/androidForegroundNotificationPorts";
import { decideAndroidForegroundNotification } from "../domain/policies/androidForegroundNotificationPolicy";

const CHANNEL = {
  id: "expense_notifications" as const,
  name: "지출 알림" as const,
  importance: "default" as const,
};

class DefaultAndroidForegroundNotificationApplication
  implements AndroidForegroundNotificationInputPort
{
  constructor(
    private readonly notifications: AndroidSystemNotificationPort,
    private readonly ids: AndroidNotificationIdPort,
  ) {}

  async receive(
    input: Parameters<AndroidForegroundNotificationInputPort["receive"]>[0],
  ): Promise<AndroidForegroundResult> {
    const decision = decideAndroidForegroundNotification({
      androidApiLevel: input.androidApiLevel,
      postNotificationsPermission: input.postNotificationsPermission,
      payloadVersion: input.payload.payloadVersion,
      ...(input.payload.notification === undefined
        ? {}
        : { notification: input.payload.notification }),
    });
    if (decision.kind === "DoNotDisplay") {
      return { kind: "not-displayed", reason: decision.reason };
    }

    const notificationId = this.ids.next();
    await this.notifications.display({
      notificationId,
      title: decision.title,
      body: decision.body,
      channelId: CHANNEL.id,
      channelName: CHANNEL.name,
      importance: CHANNEL.importance,
      contentActivity: "MainActivity",
    });
    return {
      kind: "displayed",
      notificationId,
      channel: { ...CHANNEL },
      contentIntent: { activity: "MainActivity" },
    };
  }
}

export function createAndroidForegroundNotificationApplication(
  notifications: AndroidSystemNotificationPort,
  ids: AndroidNotificationIdPort,
): AndroidForegroundNotificationInputPort {
  return new DefaultAndroidForegroundNotificationApplication(
    notifications,
    ids,
  );
}
