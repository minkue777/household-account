import type {
  PwaCacheAdmissionDecision,
  PwaRuntimeCacheCandidate,
  PwaRuntimeCacheEntry,
} from "../model/pwaRuntimeCache";

const MAX_RUNTIME_TTL_SECONDS = 7 * 24 * 60 * 60;
const SENSITIVE_PATH_PREFIXES = [
  "/api",
  "/auth",
  "/login",
  "/households",
  "/members",
  "/expenses",
  "/transactions",
  "/assets",
  "/statistics",
] as const;

export interface PwaRuntimeCacheConfiguration {
  readonly origin: string;
  readonly publicRuntimeAllowlist: readonly string[];
  readonly cacheNamespace: string;
}

export type PwaRuntimeCacheAdmission =
  | {
      readonly decision: Extract<PwaCacheAdmissionDecision, { kind: "Cached" }>;
      readonly entry: PwaRuntimeCacheEntry;
    }
  | { readonly decision: { readonly kind: "NetworkOnly" } };

function normalizedHeaders(
  headers: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    const key = name.trim().toLowerCase();
    const normalizedValue = value.trim();
    normalized[key] =
      normalized[key] === undefined
        ? normalizedValue
        : `${normalized[key]},${normalizedValue}`;
  }
  return normalized;
}

function isSensitivePath(pathname: string): boolean {
  return SENSITIVE_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isPublicStaticContentType(value: string): boolean {
  const mediaType = value.split(";", 1)[0].trim().toLowerCase();
  return (
    mediaType.startsWith("image/") ||
    mediaType.startsWith("font/") ||
    mediaType === "application/font-woff" ||
    mediaType === "application/font-woff2" ||
    mediaType === "application/vnd.ms-fontobject"
  );
}

function cacheControlMaxAge(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  for (const directive of value.split(",")) {
    const [name, rawValue] = directive.trim().split("=", 2);
    if (name.toLowerCase() !== "max-age" || rawValue === undefined) continue;
    const seconds = Number(rawValue.replace(/^"|"$/g, ""));
    return Number.isSafeInteger(seconds) && seconds >= 0
      ? seconds
      : undefined;
  }
  return undefined;
}

function hasForbiddenCacheDirective(value: string | undefined): boolean {
  return (value ?? "")
    .split(",")
    .map((directive) => directive.trim().split("=", 1)[0].toLowerCase())
    .some(
      (directive) =>
        directive === "private" ||
        directive === "no-store" ||
        directive === "no-cache",
    );
}

function validOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
}

function validReceivedAt(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function evaluatePwaRuntimeCacheAdmissionPolicy(input: {
  readonly candidate: PwaRuntimeCacheCandidate;
  readonly configuration: PwaRuntimeCacheConfiguration;
}): PwaRuntimeCacheAdmission {
  const expectedOrigin = validOrigin(input.configuration.origin);
  let requestUrl: URL;
  try {
    requestUrl = new URL(input.candidate.requestUrl);
  } catch {
    return { decision: { kind: "NetworkOnly" } };
  }
  const receivedAt = validReceivedAt(input.candidate.receivedAt);
  const requestHeaders = normalizedHeaders(input.candidate.requestHeaders);
  const responseHeaders = normalizedHeaders(input.candidate.responseHeaders);
  const cacheControl = responseHeaders["cache-control"];
  if (
    expectedOrigin === undefined ||
    requestUrl.origin !== expectedOrigin ||
    requestUrl.username !== "" ||
    requestUrl.password !== "" ||
    requestUrl.search !== "" ||
    requestUrl.hash !== "" ||
    input.candidate.requestMethod !== "GET" ||
    input.candidate.requestMode === "navigate" ||
    input.candidate.responseStatus !== 200 ||
    receivedAt === undefined ||
    isSensitivePath(requestUrl.pathname) ||
    !input.configuration.publicRuntimeAllowlist.includes(requestUrl.pathname) ||
    !isPublicStaticContentType(input.candidate.responseContentType) ||
    requestHeaders.authorization !== undefined ||
    requestHeaders.cookie !== undefined ||
    responseHeaders["set-cookie"] !== undefined ||
    hasForbiddenCacheDirective(cacheControl)
  ) {
    return { decision: { kind: "NetworkOnly" } };
  }

  const responseMaxAge = cacheControlMaxAge(cacheControl);
  const ttlSeconds = Math.min(
    responseMaxAge ?? MAX_RUNTIME_TTL_SECONDS,
    MAX_RUNTIME_TTL_SECONDS,
  );
  if (ttlSeconds === 0) {
    return { decision: { kind: "NetworkOnly" } };
  }
  const expiresAtDate = new Date(receivedAt + ttlSeconds * 1_000);
  if (!Number.isFinite(expiresAtDate.getTime())) {
    return { decision: { kind: "NetworkOnly" } };
  }
  const expiresAt = expiresAtDate.toISOString();
  const requestUrlWithoutFragment = requestUrl.toString();
  return {
    decision: { kind: "Cached", expiresAt },
    entry: {
      cacheKey: `${input.configuration.cacheNamespace}:${requestUrlWithoutFragment}`,
      requestUrl: requestUrlWithoutFragment,
      bodyMarker: input.candidate.bodyMarker,
      receivedAt: new Date(receivedAt).toISOString(),
      expiresAt,
    },
  };
}

export function canReadPwaRuntimeCacheEntryPolicy(input: {
  readonly entry: PwaRuntimeCacheEntry;
  readonly requestUrl: string;
  readonly at: string;
  readonly configuration: PwaRuntimeCacheConfiguration;
}): boolean {
  const at = validReceivedAt(input.at);
  const expectedOrigin = validOrigin(input.configuration.origin);
  let requestUrl: URL;
  try {
    requestUrl = new URL(input.requestUrl);
  } catch {
    return false;
  }
  return (
    at !== undefined &&
    expectedOrigin !== undefined &&
    requestUrl.origin === expectedOrigin &&
    requestUrl.search === "" &&
    requestUrl.hash === "" &&
    !isSensitivePath(requestUrl.pathname) &&
    input.configuration.publicRuntimeAllowlist.includes(requestUrl.pathname) &&
    input.entry.requestUrl === requestUrl.toString() &&
    at < Date.parse(input.entry.expiresAt)
  );
}
