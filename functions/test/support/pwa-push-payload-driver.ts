import { createPwaPushApplication } from "../reference/pwa/application/pwaPushApplication";
import type {
  PwaNotificationDisplayPort,
  PwaPushTelemetryPort,
} from "../reference/pwa/application/ports/out/pwaPushPorts";
import type {
  PwaPushContractFailureCode,
  PwaPushHandlingResult,
  PwaPushInputPort,
  TrustedPwaPushNotification,
} from "../reference/pwa/public";

export interface PwaPushPayloadState {
  readonly displayedNotificationIds: readonly string[];
  readonly contractFailureCodes: readonly string[];
}

export interface PwaPushPayloadDriver extends PwaPushInputPort {
  state(): PwaPushPayloadState;
  displayedNotifications(): readonly TrustedPwaPushNotification[];
}

export interface PwaPushPayloadFixture {
  readonly origin?: string;
  readonly routeTemplates?: Readonly<
    Record<"expense" | "asset", string>
  >;
  readonly allowedRoutes?: Readonly<
    Record<
      "expense" | "asset",
      { readonly pathPrefix: string; readonly segmentCount: number }
    >
  >;
}

class CapturingNotificationDisplay implements PwaNotificationDisplayPort {
  private readonly notifications: TrustedPwaPushNotification[] = [];

  async display(notification: TrustedPwaPushNotification): Promise<void> {
    this.notifications.push(structuredClone(notification));
  }

  displayedNotifications(): readonly TrustedPwaPushNotification[] {
    return this.notifications.map((notification) =>
      structuredClone(notification),
    );
  }
}

class CapturingPwaTelemetry implements PwaPushTelemetryPort {
  private readonly codes: PwaPushContractFailureCode[] = [];

  recordContractFailure(code: PwaPushContractFailureCode): void {
    this.codes.push(code);
  }

  contractFailureCodes(): readonly PwaPushContractFailureCode[] {
    return [...this.codes];
  }
}

export function createPwaPushPayloadDriver(
  fixture: PwaPushPayloadFixture = {},
): PwaPushPayloadDriver {
  const display = new CapturingNotificationDisplay();
  const telemetry = new CapturingPwaTelemetry();
  const input: PwaPushInputPort = createPwaPushApplication({
    routeConfiguration: {
      origin: fixture.origin ?? "https://household.example",
      routeTemplates: fixture.routeTemplates ?? {
        expense: "/expenses/:identifier",
        asset: "/assets/:identifier",
      },
      allowedRoutes: fixture.allowedRoutes ?? {
        expense: { pathPrefix: "/expenses/", segmentCount: 2 },
        asset: { pathPrefix: "/assets/", segmentCount: 2 },
      },
    },
    display,
    telemetry,
  });
  return {
    receive(payload: unknown): Promise<PwaPushHandlingResult> {
      return input.receive(payload);
    },
    state(): PwaPushPayloadState {
      return {
        displayedNotificationIds: display
          .displayedNotifications()
          .map(({ notificationId }) => notificationId),
        contractFailureCodes: telemetry.contractFailureCodes(),
      };
    },
    displayedNotifications(): readonly TrustedPwaPushNotification[] {
      return display.displayedNotifications();
    },
  };
}
