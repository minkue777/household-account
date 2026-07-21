import type { WebSecurityHeaders } from "../model/webSecurityHeader";

export interface WebSecurityHeaderConfiguration {
  readonly productionOrigin: string;
  readonly https: boolean;
  readonly allowedFirebaseOrigins: readonly string[];
  readonly headerOverrides?: Readonly<Record<string, string | undefined>>;
}

export interface NormalizedWebSecurityHeaderConfiguration {
  readonly productionOrigin: string;
  readonly https: boolean;
  readonly allowedFirebaseOrigins: readonly string[];
}

type MutableSecurityHeaders = Record<string, string | undefined>;

const canonicalHeaderNames = new Map<string, string>([
  ["content-security-policy", "Content-Security-Policy"],
  ["x-content-type-options", "X-Content-Type-Options"],
  ["referrer-policy", "Referrer-Policy"],
  ["permissions-policy", "Permissions-Policy"],
  ["strict-transport-security", "Strict-Transport-Security"],
]);

const requiredCspDirectives = {
  "default-src": ["'self'"],
  "base-uri": ["'self'"],
  "object-src": ["'none'"],
  "frame-ancestors": ["'none'"],
} as const;

const safeReferrerPolicies = new Set([
  "no-referrer",
  "same-origin",
  "strict-origin",
  "strict-origin-when-cross-origin",
]);

function normalizedHttpOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.hostname.includes("*") ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

export function normalizeWebSecurityHeaderConfiguration(
  configuration: WebSecurityHeaderConfiguration,
): NormalizedWebSecurityHeaderConfiguration | undefined {
  const productionOrigin = normalizedHttpOrigin(configuration.productionOrigin);
  if (productionOrigin === undefined) return undefined;
  if (
    (configuration.https && !productionOrigin.startsWith("https://")) ||
    (!configuration.https && !productionOrigin.startsWith("http://"))
  ) {
    return undefined;
  }

  const allowedFirebaseOrigins: string[] = [];
  for (const candidate of configuration.allowedFirebaseOrigins) {
    const normalized = normalizedHttpOrigin(candidate);
    if (normalized === undefined) return undefined;
    if (configuration.https && !normalized.startsWith("https://")) {
      return undefined;
    }
    if (!allowedFirebaseOrigins.includes(normalized)) {
      allowedFirebaseOrigins.push(normalized);
    }
  }
  return { productionOrigin, https: configuration.https, allowedFirebaseOrigins };
}

function buildContentSecurityPolicy(
  configuration: NormalizedWebSecurityHeaderConfiguration,
): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "script-src 'self'",
    `connect-src 'self' ${configuration.allowedFirebaseOrigins.join(" ")}`.trim(),
  ].join("; ");
}

export function buildWebSecurityHeaders(
  configuration: NormalizedWebSecurityHeaderConfiguration,
  overrides: Readonly<Record<string, string | undefined>> | undefined,
): MutableSecurityHeaders {
  const headers: MutableSecurityHeaders = {
    "Content-Security-Policy": buildContentSecurityPolicy(configuration),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
  if (configuration.https) {
    headers["Strict-Transport-Security"] =
      "max-age=31536000; includeSubDomains";
  }

  for (const [name, value] of Object.entries(overrides ?? {})) {
    const canonical = canonicalHeaderNames.get(name.toLowerCase());
    if (canonical !== undefined) headers[canonical] = value;
  }
  return headers;
}

interface ParsedCsp {
  readonly directives: ReadonlyMap<string, readonly string[]>;
  readonly duplicateDirective: boolean;
}

function parseContentSecurityPolicy(value: string): ParsedCsp {
  const directives = new Map<string, readonly string[]>();
  let duplicateDirective = false;
  for (const rawDirective of value.split(";")) {
    const part = rawDirective.trim();
    if (part === "") continue;
    const [rawName, ...tokens] = part.split(/\s+/);
    const name = rawName.toLowerCase();
    if (directives.has(name)) duplicateDirective = true;
    directives.set(name, tokens);
  }
  return { directives, duplicateDirective };
}

function sameTokens(
  actual: readonly string[] | undefined,
  expected: readonly string[],
): boolean {
  return (
    actual !== undefined &&
    actual.length === expected.length &&
    expected.every((token) => actual.includes(token))
  );
}

function isSafeScriptSource(token: string): boolean {
  return (
    token === "'self'" ||
    token === "'strict-dynamic'" ||
    /^'nonce-[A-Za-z0-9+/_=-]+'$/.test(token) ||
    /^'sha(?:256|384|512)-[A-Za-z0-9+/=_-]+'$/.test(token)
  );
}

function validateContentSecurityPolicy(
  value: string | undefined,
  configuration: NormalizedWebSecurityHeaderConfiguration,
): boolean {
  if (value === undefined) return false;
  const parsed = parseContentSecurityPolicy(value);
  if (parsed.duplicateDirective) return false;
  for (const [directive, tokens] of Object.entries(requiredCspDirectives)) {
    if (!sameTokens(parsed.directives.get(directive), tokens)) return false;
  }

  const scriptSources = parsed.directives.get("script-src");
  if (
    scriptSources === undefined ||
    !scriptSources.includes("'self'") ||
    scriptSources.some((token) => !isSafeScriptSource(token))
  ) {
    return false;
  }

  const expectedConnections = [
    "'self'",
    ...configuration.allowedFirebaseOrigins,
  ];
  return sameTokens(
    parsed.directives.get("connect-src"),
    expectedConnections,
  );
}

function validatePermissionsPolicy(value: string | undefined): boolean {
  if (value === undefined) return false;
  const directives = new Map<string, string>();
  for (const rawDirective of value.split(",")) {
    const match = /^\s*([a-z-]+)\s*=\s*\(([^)]*)\)\s*$/i.exec(rawDirective);
    if (match === null) return false;
    const name = match[1].toLowerCase();
    if (directives.has(name)) return false;
    directives.set(name, match[2].trim());
  }
  return ["camera", "microphone", "geolocation"].every(
    (directive) => directives.get(directive) === "",
  );
}

function validateHsts(value: string | undefined, https: boolean): boolean {
  if (!https) return value === undefined;
  if (value === undefined) return false;
  const directives = value
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  const maxAgeDirectives = directives.filter((directive) =>
    /^max-age=/i.test(directive),
  );
  if (maxAgeDirectives.length !== 1) return false;
  const match = /^max-age=(\d+)$/i.exec(maxAgeDirectives[0]);
  if (match === null || Number(match[1]) < 31_536_000) return false;
  return directives.some(
    (directive) => directive.toLowerCase() === "includesubdomains",
  );
}

export function validateWebSecurityHeaders(
  headers: MutableSecurityHeaders,
  configuration: NormalizedWebSecurityHeaderConfiguration,
): headers is MutableSecurityHeaders & WebSecurityHeaders {
  return (
    validateContentSecurityPolicy(
      headers["Content-Security-Policy"],
      configuration,
    ) &&
    headers["X-Content-Type-Options"] === "nosniff" &&
    safeReferrerPolicies.has(
      headers["Referrer-Policy"]?.trim().toLowerCase() ?? "",
    ) &&
    validatePermissionsPolicy(headers["Permissions-Policy"]) &&
    validateHsts(headers["Strict-Transport-Security"], configuration.https)
  );
}

export function normalizedWebResourceOrigin(value: string): string | undefined {
  return normalizedHttpOrigin(value);
}
