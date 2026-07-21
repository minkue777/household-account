import {
  validateProviderUrl,
  type ProviderNetworkPolicy,
} from "../domain/safeHttpPolicy";
import type {
  SafeExternalTextHttpInputPort,
  SafeExternalTextHttpRequest,
  SafeExternalTextHttpResult,
} from "./ports/in/safeExternalTextHttpInputPort";
import type { ExternalTextHttpTransportPort } from "./ports/out/externalTextHttpTransportPort";

export interface SafeExternalTextHttpPolicy {
  readonly providers: readonly ProviderNetworkPolicy[];
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  readonly maxResponseBytes: number;
}

function securityFailure(
  code: "HTTPS_REQUIRED" | "PROVIDER_HOST_NOT_ALLOWED" | "PORT_NOT_ALLOWED",
  attempts: number,
): SafeExternalTextHttpResult {
  return { kind: "security-policy-violation", code, attempts };
}

function retryableStatus(status: number):
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | undefined {
  if (status === 429) return "RATE_LIMITED";
  return status >= 500 ? "PROVIDER_UNAVAILABLE" : undefined;
}

export function createSafeExternalTextHttpApplication(dependencies: {
  readonly policy: SafeExternalTextHttpPolicy;
  readonly transport: ExternalTextHttpTransportPort;
}): SafeExternalTextHttpInputPort {
  async function execute(
    request: SafeExternalTextHttpRequest,
  ): Promise<SafeExternalTextHttpResult> {
    const providerPolicy = dependencies.policy.providers.find(
      ({ provider }) => provider === request.provider,
    );
    if (providerPolicy === undefined) {
      return securityFailure("PROVIDER_HOST_NOT_ALLOWED", 0);
    }
    const initial = validateProviderUrl(providerPolicy, request.url);
    if (initial.kind === "blocked") return securityFailure(initial.code, 0);

    for (let attempt = 1; attempt <= dependencies.policy.maxAttempts; attempt += 1) {
      let currentUrl = initial.canonicalUrl;
      let redirectHops = 0;
      const visited = new Set<string>();

      while (true) {
        visited.add(currentUrl);
        const result = await dependencies.transport.execute({
          url: currentUrl,
          method: request.method ?? "GET",
          headers: request.headers ?? {},
          ...(request.body === undefined ? {} : { body: request.body }),
          timeoutMs: dependencies.policy.timeoutMs,
          maxResponseBytes: dependencies.policy.maxResponseBytes,
        });
        if (result.kind === "timeout" || result.kind === "network-failure") {
          if (attempt < dependencies.policy.maxAttempts) break;
          return {
            kind: "retryable-failure",
            code: result.kind === "timeout" ? "TIMEOUT" : "NETWORK_FAILURE",
            attempts: attempt,
          };
        }
        if (result.kind === "response-too-large") {
          return {
            kind: "contract-failure",
            code: "RESPONSE_TOO_LARGE",
            attempts: attempt,
          };
        }
        if (result.status >= 300 && result.status < 400) {
          if (result.location === undefined) {
            return {
              kind: "security-policy-violation",
              code: "REDIRECT_NOT_ALLOWED",
              attempts: attempt,
            };
          }
          const resolved = new URL(result.location, currentUrl).href;
          redirectHops += 1;
          const validated = validateProviderUrl(providerPolicy, resolved);
          if (
            validated.kind === "blocked" ||
            redirectHops > providerPolicy.maxRedirectHops ||
            visited.has(resolved)
          ) {
            return {
              kind: "security-policy-violation",
              code:
                validated.kind === "blocked"
                  ? validated.code
                  : "REDIRECT_NOT_ALLOWED",
              attempts: attempt,
            };
          }
          currentUrl = validated.canonicalUrl;
          continue;
        }
        if (result.status === 200) {
          return {
            kind: "success",
            body: result.body,
            finalUrl: currentUrl,
            responseBytes: result.bodyBytes,
            attempts: attempt,
          };
        }
        const retryCode = retryableStatus(result.status);
        if (retryCode !== undefined) {
          if (attempt < dependencies.policy.maxAttempts) break;
          return {
            kind: "retryable-failure",
            code: retryCode,
            attempts: attempt,
          };
        }
        return {
          kind: "contract-failure",
          code: "HTTP_STATUS_NOT_SUPPORTED",
          attempts: attempt,
        };
      }
    }
    return { kind: "retryable-failure", code: "NETWORK_FAILURE", attempts: 0 };
  }

  return { execute };
}
