import { buildPwaNotificationRoutePolicy } from "../domain/policies/pwaNotificationRoute";
import type { PwaNotificationRouteConfiguration } from "../domain/policies/pwaNotificationRoute";
import type {
  PwaNotificationNavigationInputPort,
  PwaNotificationNavigationResult,
} from "./ports/in/pwaNotificationNavigationInputPort";
import type { PwaClientNavigationPort } from "./ports/out/pwaClientNavigationPort";

export function createPwaNotificationNavigationApplication(dependencies: {
  readonly routeConfiguration: PwaNotificationRouteConfiguration;
  readonly clients: PwaClientNavigationPort;
}): PwaNotificationNavigationInputPort {
  return {
    navigate(input): PwaNotificationNavigationResult {
      const route = buildPwaNotificationRoutePolicy({
        route: input.route,
        configuration: dependencies.routeConfiguration,
      });
      if (route.kind === "Rejected") return route;

      const navigation = {
        origin: route.origin,
        destination: route.destination,
      };
      const client = dependencies.clients.findMatchingClient(navigation);
      if (client !== undefined) {
        dependencies.clients.focus({ ...navigation, clientId: client.clientId });
        return { kind: "Focused", ...navigation };
      }

      dependencies.clients.open(navigation);
      return { kind: "Opened", ...navigation };
    },
  };
}
