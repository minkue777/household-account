import { createAndroidForegroundNotificationApplication } from "../../src/contexts/notifications/application/androidForegroundNotificationApplication";
import type {
  AndroidNotificationIdPort,
  AndroidSystemNotificationPort,
} from "../../src/contexts/notifications/application/ports/outbound/androidForegroundNotificationPorts";
import type { AndroidForegroundNotificationInputPort } from "../../src/contexts/notifications/public";

export interface AndroidForegroundSnapshot {
  displayedNotifications: readonly {
    notificationId: number;
    title: string;
    body: string;
    channelId: "expense_notifications";
    contentActivity: "MainActivity";
  }[];
}

export interface AndroidForegroundNotificationFixtureSubject
  extends AndroidForegroundNotificationInputPort {
  snapshot(): Promise<AndroidForegroundSnapshot>;
}

class FixtureAndroidSystemNotifications
  implements AndroidSystemNotificationPort
{
  private readonly displayed: {
    notificationId: number;
    title: string;
    body: string;
    channelId: "expense_notifications";
    contentActivity: "MainActivity";
  }[] = [];

  async display(input: {
    notificationId: number;
    title: string;
    body: string;
    channelId: "expense_notifications";
    channelName: "지출 알림";
    importance: "default";
    contentActivity: "MainActivity";
  }): Promise<void> {
    this.displayed.push({
      notificationId: input.notificationId,
      title: input.title,
      body: input.body,
      channelId: input.channelId,
      contentActivity: input.contentActivity,
    });
  }

  snapshot(): AndroidForegroundSnapshot {
    return {
      displayedNotifications: this.displayed.map((notification) => ({
        ...notification,
      })),
    };
  }
}

class SequenceAndroidNotificationIds implements AndroidNotificationIdPort {
  private current = 0;

  next(): number {
    this.current += 1;
    return this.current;
  }
}

export function createAndroidForegroundNotificationFixtureSubject(): AndroidForegroundNotificationFixtureSubject {
  const notifications = new FixtureAndroidSystemNotifications();
  const input = createAndroidForegroundNotificationApplication(
    notifications,
    new SequenceAndroidNotificationIds(),
  );
  return {
    receive: (message) => input.receive(message),
    snapshot: async () => notifications.snapshot(),
  };
}
