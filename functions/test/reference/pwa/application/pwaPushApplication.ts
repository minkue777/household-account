import type { PwaPushHandlingResult } from "../domain/model/pwaPushPayload";
import {
  buildPwaNotificationRoutePolicy,
  type PwaNotificationRouteConfiguration,
} from "../domain/policies/pwaNotificationRoute";
import { validatePwaPushPayloadPolicy } from "../domain/policies/pwaPushPayloadValidation";
import type { PwaPushInputPort } from "./ports/in/pwaPushInputPort";
import type {
  PwaNotificationDisplayPort,
  PwaPushTelemetryPort,
} from "./ports/out/pwaPushPorts";

export function createPwaPushApplication(dependencies: {
  readonly routeConfiguration: PwaNotificationRouteConfiguration;
  readonly display: PwaNotificationDisplayPort;
  readonly telemetry: PwaPushTelemetryPort;
}): PwaPushInputPort {
  return {
    async receive(candidate: unknown): Promise<PwaPushHandlingResult> {
      const validation = validatePwaPushPayloadPolicy(candidate);
      if (validation.kind === "Rejected") {
        dependencies.telemetry.recordContractFailure(validation.code);
        return validation;
      }

      const route = buildPwaNotificationRoutePolicy({
        route: validation.payload.route,
        configuration: dependencies.routeConfiguration,
      });
      if (route.kind === "Rejected") {
        dependencies.telemetry.recordContractFailure("ROUTE_NOT_ALLOWED");
        return { kind: "Rejected", code: "ROUTE_NOT_ALLOWED" };
      }

      await dependencies.display.display({
        notificationId: validation.payload.notificationId,
        title: validation.payload.title,
        body: validation.payload.body,
        route: { ...validation.payload.route },
        navigation: {
          origin: route.origin,
          destination: route.destination,
        },
      });
      return {
        kind: "Displayed",
        notificationId: validation.payload.notificationId,
      };
    },
  };
}
