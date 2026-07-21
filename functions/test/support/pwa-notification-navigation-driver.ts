import { createPwaNotificationNavigationApplication } from "../reference/pwa/application/pwaNotificationNavigationApplication";
import type { PwaClientNavigationPort } from "../reference/pwa/application/ports/out/pwaClientNavigationPort";
import {
  validateTrustedPwaNotificationRoutePolicy,
  type PwaNotificationRouteConfiguration,
} from "../reference/pwa/domain/policies/pwaNotificationRoute";
import type {
  PwaNotificationNavigationInputPort,
  PwaNotificationNavigationResult,
  TrustedPwaNotificationRoute,
} from "../reference/pwa/public";

export interface PwaNotificationNavigationState {
  readonly focusedDestinations: readonly string[];
  readonly openedDestinations: readonly string[];
}

export interface PwaNotificationNavigationDriver {
  navigate(input: {
    readonly payload: TrustedPwaNotificationRoute | Readonly<Record<string, unknown>>;
    readonly matchingClientExists: boolean;
  }): PwaNotificationNavigationResult;
  state(): PwaNotificationNavigationState;
}

export interface PwaNotificationNavigationFixture
  extends PwaNotificationRouteConfiguration {}

class CapturingPwaClientNavigation implements PwaClientNavigationPort {
  private readonly focused: string[] = [];
  private readonly opened: string[] = [];
  private matchingClientExists = false;

  setMatchingClientExists(value: boolean): void {
    this.matchingClientExists = value;
  }

  findMatchingClient(): { readonly clientId: string } | undefined {
    return this.matchingClientExists ? { clientId: "matching-client" } : undefined;
  }

  focus(input: { readonly clientId: string; readonly destination: string }): void {
    void input.clientId;
    this.focused.push(input.destination);
  }

  open(input: { readonly destination: string }): void {
    this.opened.push(input.destination);
  }

  state(): PwaNotificationNavigationState {
    return {
      focusedDestinations: [...this.focused],
      openedDestinations: [...this.opened],
    };
  }
}

export function createPwaNotificationNavigationDriver(
  fixture: PwaNotificationNavigationFixture,
): PwaNotificationNavigationDriver {
  const clients = new CapturingPwaClientNavigation();
  const input: PwaNotificationNavigationInputPort =
    createPwaNotificationNavigationApplication({
      routeConfiguration: fixture,
      clients,
    });
  return {
    navigate(command): PwaNotificationNavigationResult {
      const route = validateTrustedPwaNotificationRoutePolicy(command.payload);
      if (route.kind === "Rejected") return route;
      clients.setMatchingClientExists(command.matchingClientExists);
      return input.navigate({
        route: route.route,
      });
    },
    state(): PwaNotificationNavigationState {
      return clients.state();
    },
  };
}
