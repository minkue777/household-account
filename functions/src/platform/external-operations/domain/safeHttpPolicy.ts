export interface ProviderNetworkPolicy {
  readonly provider: string;
  readonly allowedHosts: readonly string[];
  readonly allowedPorts: readonly number[];
  readonly maxRedirectHops: number;
}

export type SafeUrlValidation =
  | { readonly kind: "allowed"; readonly canonicalUrl: string }
  | {
      readonly kind: "blocked";
      readonly code:
        | "HTTPS_REQUIRED"
        | "PROVIDER_HOST_NOT_ALLOWED"
        | "PORT_NOT_ALLOWED";
      readonly blockedUrl: string;
    };

export function validateProviderUrl(
  policy: ProviderNetworkPolicy,
  rawUrl: string,
): SafeUrlValidation {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return {
      kind: "blocked",
      code: "PROVIDER_HOST_NOT_ALLOWED",
      blockedUrl: rawUrl,
    };
  }
  if (url.protocol !== "https:") {
    return { kind: "blocked", code: "HTTPS_REQUIRED", blockedUrl: rawUrl };
  }
  if (
    url.username !== "" ||
    url.password !== "" ||
    !policy.allowedHosts.includes(url.hostname.toLowerCase())
  ) {
    return {
      kind: "blocked",
      code: "PROVIDER_HOST_NOT_ALLOWED",
      blockedUrl: rawUrl,
    };
  }
  const port = url.port === "" ? 443 : Number(url.port);
  if (!policy.allowedPorts.includes(port)) {
    return { kind: "blocked", code: "PORT_NOT_ALLOWED", blockedUrl: rawUrl };
  }
  return { kind: "allowed", canonicalUrl: url.href };
}
