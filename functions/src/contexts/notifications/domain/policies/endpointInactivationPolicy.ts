import type { MobileNotificationEndpoint } from "../model/mobileNotificationEndpoint";

const INACTIVE_RETENTION_MILLISECONDS = 30 * 24 * 60 * 60 * 1_000;

export type EndpointInactivationObservation =
  | { source: "sdk-unregistered" }
  | { source: "provider"; httpStatus: number; code: string };

export type EndpointInactivationDecision =
  | { kind: "Inactivated"; endpoint: MobileNotificationEndpoint }
  | { kind: "StaleIgnored" }
  | { kind: "NotPermanentFailure" };

export function isPermanentEndpointFailure(
  observation: EndpointInactivationObservation,
): boolean {
  return (
    observation.source === "sdk-unregistered" ||
    (observation.httpStatus === 404 && observation.code === "UNREGISTERED")
  );
}

export function decideEndpointInactivation(input: {
  current: MobileNotificationEndpoint | null;
  expectedRegistrationVersion: number;
  expectedBindingVersion: number;
  now: string;
  observation: EndpointInactivationObservation;
}): EndpointInactivationDecision {
  if (!isPermanentEndpointFailure(input.observation)) {
    return { kind: "NotPermanentFailure" };
  }

  if (
    input.current === null ||
    input.current.registrationVersion !== input.expectedRegistrationVersion ||
    input.current.bindingVersion !== input.expectedBindingVersion
  ) {
    return { kind: "StaleIgnored" };
  }

  if (input.current.status === "inactive") {
    return { kind: "Inactivated", endpoint: { ...input.current } };
  }

  return {
    kind: "Inactivated",
    endpoint: {
      ...input.current,
      status: "inactive",
      inactiveAt: input.now,
      expiresAt: new Date(
        Date.parse(input.now) + INACTIVE_RETENTION_MILLISECONDS,
      ).toISOString(),
    },
  };
}
