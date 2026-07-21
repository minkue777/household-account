import type {
  PwaPushPayloadDecision,
  ValidatedPwaPushPayload,
} from "../model/pwaPushPayload";
import { validateTrustedPwaNotificationRoutePolicy } from "./pwaNotificationRoute";

const REQUIRED_FIELDS = [
  "notificationId",
  "title",
  "body",
  "route",
] as const;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(
  value: Readonly<Record<string, unknown>>,
  key: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function validatePwaPushPayloadPolicy(
  candidate: unknown,
): PwaPushPayloadDecision {
  if (!isRecord(candidate)) {
    return { kind: "Rejected", code: "FIELD_TYPE_INVALID" };
  }
  if (!hasOwn(candidate, "version")) {
    return { kind: "Rejected", code: "REQUIRED_FIELD_MISSING" };
  }
  if (typeof candidate.version !== "string") {
    return { kind: "Rejected", code: "FIELD_TYPE_INVALID" };
  }
  if (candidate.version !== "notification.v1") {
    return { kind: "Rejected", code: "VERSION_UNSUPPORTED" };
  }
  if (REQUIRED_FIELDS.some((field) => !hasOwn(candidate, field))) {
    return { kind: "Rejected", code: "REQUIRED_FIELD_MISSING" };
  }
  if (
    typeof candidate.notificationId !== "string" ||
    typeof candidate.title !== "string" ||
    typeof candidate.body !== "string" ||
    !isRecord(candidate.route)
  ) {
    return { kind: "Rejected", code: "FIELD_TYPE_INVALID" };
  }
  if (
    !hasOwn(candidate.route, "kind") ||
    !hasOwn(candidate.route, "identifier")
  ) {
    return { kind: "Rejected", code: "REQUIRED_FIELD_MISSING" };
  }
  if (
    typeof candidate.route.kind !== "string" ||
    typeof candidate.route.identifier !== "string"
  ) {
    return { kind: "Rejected", code: "FIELD_TYPE_INVALID" };
  }
  if (
    candidate.notificationId.trim() === "" ||
    candidate.title.trim() === "" ||
    candidate.body.trim() === "" ||
    candidate.route.identifier.trim() === ""
  ) {
    return { kind: "Rejected", code: "REQUIRED_FIELD_MISSING" };
  }
  const route = validateTrustedPwaNotificationRoutePolicy(candidate.route);
  if (route.kind === "Rejected") {
    return { kind: "Rejected", code: "ROUTE_NOT_ALLOWED" };
  }

  const payload: ValidatedPwaPushPayload = {
    version: "notification.v1",
    notificationId: candidate.notificationId,
    title: candidate.title,
    body: candidate.body,
    route: route.route,
  };
  return { kind: "Valid", payload };
}
