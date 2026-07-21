import type {
  PwaPushRouteKind,
  TrustedPwaNotificationRoute,
} from "../model/pwaPushPayload";

export interface PwaNotificationRouteConfiguration {
  readonly origin: string;
  readonly routeTemplates: Readonly<Record<PwaPushRouteKind, string>>;
  readonly allowedRoutes: Readonly<
    Record<
      PwaPushRouteKind,
      { readonly pathPrefix: string; readonly segmentCount: number }
    >
  >;
}

export type PwaNotificationRouteDecision =
  | {
      readonly kind: "Allowed";
      readonly origin: string;
      readonly destination: string;
    }
  | {
      readonly kind: "Rejected";
      readonly code: "PATH_TRAVERSAL" | "ROUTE_SHAPE_INVALID";
    };

export type TrustedPwaNotificationRouteDecision =
  | {
      readonly kind: "Trusted";
      readonly route: TrustedPwaNotificationRoute;
    }
  | {
      readonly kind: "Rejected";
      readonly code:
        | "RAW_URL_NOT_ALLOWED"
        | "ROUTE_NOT_ALLOWED"
        | "INVALID_IDENTIFIER"
        | "PATH_TRAVERSAL";
    };

function normalizedOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
}

function containsTraversal(identifier: string): boolean {
  let candidate = identifier;
  for (let depth = 0; depth <= 8; depth += 1) {
    if (candidate.includes("\\")) return true;
    if (
      candidate
        .split("/")
        .some((segment) => segment === "." || segment === "..")
    ) {
      return true;
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(candidate);
    } catch {
      return false;
    }
    if (decoded === candidate) return false;
    candidate = decoded;
  }
  return true;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(
  value: Readonly<Record<string, unknown>>,
  key: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function validateTrustedPwaNotificationRoutePolicy(
  candidate: unknown,
): TrustedPwaNotificationRouteDecision {
  if (
    !isRecord(candidate) ||
    !hasOwn(candidate, "kind") ||
    typeof candidate.kind !== "string"
  ) {
    return { kind: "Rejected", code: "ROUTE_NOT_ALLOWED" };
  }
  if (candidate.kind === "raw-url") {
    return { kind: "Rejected", code: "RAW_URL_NOT_ALLOWED" };
  }
  if (candidate.kind !== "expense" && candidate.kind !== "asset") {
    return { kind: "Rejected", code: "ROUTE_NOT_ALLOWED" };
  }
  if (
    !hasOwn(candidate, "identifier") ||
    typeof candidate.identifier !== "string" ||
    candidate.identifier.trim() === ""
  ) {
    return { kind: "Rejected", code: "INVALID_IDENTIFIER" };
  }
  if (containsTraversal(candidate.identifier)) {
    return { kind: "Rejected", code: "PATH_TRAVERSAL" };
  }
  return {
    kind: "Trusted",
    route: {
      kind: candidate.kind,
      identifier: candidate.identifier,
    },
  };
}

function segmentCount(pathname: string): number {
  const withoutLeadingSlash = pathname.startsWith("/")
    ? pathname.slice(1)
    : pathname;
  return withoutLeadingSlash === "" ? 0 : withoutLeadingSlash.split("/").length;
}

export function buildPwaNotificationRoutePolicy(input: {
  readonly route: TrustedPwaNotificationRoute;
  readonly configuration: PwaNotificationRouteConfiguration;
}): PwaNotificationRouteDecision {
  const origin = normalizedOrigin(input.configuration.origin);
  if (containsTraversal(input.route.identifier)) {
    return { kind: "Rejected", code: "PATH_TRAVERSAL" };
  }
  if (origin === undefined) {
    return { kind: "Rejected", code: "ROUTE_SHAPE_INVALID" };
  }

  const template = input.configuration.routeTemplates[input.route.kind];
  if (template.split(":identifier").length !== 2) {
    return { kind: "Rejected", code: "ROUTE_SHAPE_INVALID" };
  }
  const destinationCandidate = template.replace(
    ":identifier",
    encodeURIComponent(input.route.identifier),
  );
  let destinationUrl: URL;
  try {
    destinationUrl = new URL(destinationCandidate, origin);
  } catch {
    return { kind: "Rejected", code: "ROUTE_SHAPE_INVALID" };
  }

  const allowed = input.configuration.allowedRoutes[input.route.kind];
  if (
    destinationUrl.origin !== origin ||
    destinationUrl.search !== "" ||
    destinationUrl.hash !== "" ||
    !destinationUrl.pathname.startsWith(allowed.pathPrefix) ||
    segmentCount(destinationUrl.pathname) !== allowed.segmentCount
  ) {
    return { kind: "Rejected", code: "ROUTE_SHAPE_INVALID" };
  }

  return {
    kind: "Allowed",
    origin,
    destination: destinationUrl.pathname,
  };
}
