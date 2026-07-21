import type {
  PwaRootRegistration,
  PwaRootWorkerCapability,
  PwaRuntimeInitializationInput,
} from "../model/pwaRootRuntime";
import {
  buildPwaNotificationRoutePolicy,
  validateTrustedPwaNotificationRoutePolicy,
} from "./pwaNotificationRoute";

export const integratedRootWorkerCapabilities = [
  "page",
  "cache",
  "push",
  "notification-click",
] as const satisfies readonly PwaRootWorkerCapability[];

export function isValidIntegratedRootWorkerArtifact(
  workerArtifactPaths: readonly string[],
): boolean {
  return workerArtifactPaths.length === 1 && workerArtifactPaths[0] === "/sw.js";
}

export function isIntegratedRootRegistration(
  registration: PwaRootRegistration,
): boolean {
  if (registration.scope !== "/" || registration.scriptUrl !== "/sw.js") {
    return false;
  }
  if (
    registration.capabilities.length !== integratedRootWorkerCapabilities.length
  ) {
    return false;
  }
  const capabilities = new Set(registration.capabilities);
  return integratedRootWorkerCapabilities.every((capability) =>
    capabilities.has(capability),
  );
}

export function isPwaMessagingEligible(
  input: PwaRuntimeInitializationInput,
): input is PwaRuntimeInitializationInput & {
  readonly authenticatedMemberId: string;
  readonly fid: string;
} {
  return (
    input.environment === "production" &&
    input.displayMode === "standalone" &&
    input.deviceClass === "iphone-home-pwa" &&
    typeof input.authenticatedMemberId === "string" &&
    input.authenticatedMemberId.trim().length > 0 &&
    typeof input.fid === "string" &&
    input.fid.trim().length > 0
  );
}

export function isAllowedPwaPagePath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//");
}

export function isAllowedPwaPublicAsset(
  path: string,
  allowlist: readonly string[],
): boolean {
  return allowlist.includes(path);
}

export function isAllowedPwaNotificationDestination(input: {
  readonly origin: string;
  readonly destination: string;
}): boolean {
  if (!input.destination.startsWith("/") || input.destination.startsWith("//")) {
    return false;
  }

  let destinationUrl: URL;
  let origin: URL;
  try {
    destinationUrl = new URL(input.destination, input.origin);
    origin = new URL(input.origin);
  } catch {
    return false;
  }
  if (
    destinationUrl.origin !== origin.origin ||
    destinationUrl.search !== "" ||
    destinationUrl.hash !== ""
  ) {
    return false;
  }

  const segments = destinationUrl.pathname.split("/").filter(Boolean);
  if (
    segments.length !== 2 ||
    (segments[0] !== "expenses" && segments[0] !== "assets")
  ) {
    return false;
  }

  let identifier: string;
  try {
    identifier = decodeURIComponent(segments[1]);
  } catch {
    return false;
  }
  const route = validateTrustedPwaNotificationRoutePolicy({
    kind: segments[0] === "expenses" ? "expense" : "asset",
    identifier,
  });
  if (route.kind === "Rejected") return false;

  const built = buildPwaNotificationRoutePolicy({
    route: route.route,
    configuration: {
      origin: input.origin,
      routeTemplates: {
        expense: "/expenses/:identifier",
        asset: "/assets/:identifier",
      },
      allowedRoutes: {
        expense: { pathPrefix: "/expenses/", segmentCount: 2 },
        asset: { pathPrefix: "/assets/", segmentCount: 2 },
      },
    },
  });
  return (
    built.kind === "Allowed" && built.destination === destinationUrl.pathname
  );
}
