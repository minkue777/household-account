import { createSafeNotificationClickApplication } from "../../src/contexts/notifications/application/safeNotificationClickApplication";
import type { NotificationNavigationPort } from "../../src/contexts/notifications/application/ports/outbound/notificationNavigationPort";
import type { SafeNotificationClickInputPort } from "../../src/contexts/notifications/public";

export interface NotificationNavigationSnapshot {
  focusedClients: readonly { clientId: string; url: string }[];
  openedUrls: readonly string[];
  externalNavigationUrls: readonly string[];
}

export interface SafeNotificationClickFixtureSubject
  extends SafeNotificationClickInputPort {
  snapshot(): Promise<NotificationNavigationSnapshot>;
}

class FixtureNotificationNavigation implements NotificationNavigationPort {
  private readonly focusedClients: { clientId: string; url: string }[] = [];
  private readonly openedUrls: string[] = [];

  async focus(input: { clientId: string; url: string }): Promise<void> {
    this.focusedClients.push({ ...input });
  }

  async open(url: string): Promise<void> {
    this.openedUrls.push(url);
  }

  snapshot(): NotificationNavigationSnapshot {
    return {
      focusedClients: this.focusedClients.map((client) => ({ ...client })),
      openedUrls: [...this.openedUrls],
      externalNavigationUrls: [
        ...this.focusedClients.map((client) => client.url),
        ...this.openedUrls,
      ].filter((url) => new URL(url).origin !== "https://household.example"),
    };
  }
}

export function createSafeNotificationClickFixtureSubject(): SafeNotificationClickFixtureSubject {
  const navigation = new FixtureNotificationNavigation();
  const input = createSafeNotificationClickApplication(navigation);
  return {
    handleNotificationClick: (click) => input.handleNotificationClick(click),
    snapshot: async () => navigation.snapshot(),
  };
}
