import type {
  NotificationClickInput,
  NotificationClickResult,
  SafeNotificationClickInputPort,
} from "./ports/in/safeNotificationClickPort";
import type { NotificationNavigationPort } from "./ports/outbound/notificationNavigationPort";
import { validateNotificationClickPayload } from "../domain/policies/safeNotificationClickPolicy";

function parseOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

function hasOrigin(url: string, expectedOrigin: string): boolean {
  try {
    return new URL(url).origin === expectedOrigin;
  } catch {
    return false;
  }
}

class DefaultSafeNotificationClickApplication
  implements SafeNotificationClickInputPort
{
  constructor(private readonly navigation: NotificationNavigationPort) {}

  async handleNotificationClick(
    input: NotificationClickInput,
  ): Promise<NotificationClickResult> {
    if (input.action === "dismiss") {
      return { kind: "no-navigation", reason: "DISMISSED" };
    }

    const payload = validateNotificationClickPayload(input.payload);
    if (payload.kind === "Rejected") {
      return { kind: "no-navigation", reason: payload.reason };
    }
    const applicationOrigin = parseOrigin(input.applicationOrigin);
    if (applicationOrigin === null) {
      return { kind: "no-navigation", reason: "INVALID_PAYLOAD" };
    }

    const target = new URL("/", applicationOrigin);
    target.searchParams.set("edit", payload.payload.expenseId);
    const targetUrl = target.toString();
    const client = input.clients.find((candidate) =>
      hasOrigin(candidate.url, applicationOrigin),
    );
    if (client !== undefined) {
      await this.navigation.focus({ clientId: client.clientId, url: targetUrl });
      return { kind: "focused", clientId: client.clientId, url: targetUrl };
    }

    await this.navigation.open(targetUrl);
    return { kind: "opened", url: targetUrl };
  }
}

export function createSafeNotificationClickApplication(
  navigation: NotificationNavigationPort,
): SafeNotificationClickInputPort {
  return new DefaultSafeNotificationClickApplication(navigation);
}
