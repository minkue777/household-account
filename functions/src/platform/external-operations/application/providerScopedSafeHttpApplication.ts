import {
  validateProviderUrl,
  type ProviderNetworkPolicy,
} from "../domain/safeHttpPolicy";
import type {
  ProviderScopedHttpResult,
  ProviderScopedSafeHttpInputPort,
} from "./ports/in/providerScopedSafeHttpInputPort";
import type { ScriptedHttpTransportPort } from "./ports/out/scriptedHttpTransportPort";

export function createProviderScopedSafeHttpApplication(dependencies: {
  readonly policies: readonly ProviderNetworkPolicy[];
  readonly transport: ScriptedHttpTransportPort;
}): ProviderScopedSafeHttpInputPort {
  return {
    async get(input): Promise<ProviderScopedHttpResult> {
      const policy = dependencies.policies.find(
        (candidate) => candidate.provider === input.provider,
      );
      if (policy === undefined) {
        return {
          kind: "security-policy-violation",
          code: "PROVIDER_HOST_NOT_ALLOWED",
          blockedUrl: input.url,
          networkAttempts: 0,
        };
      }
      const initial = validateProviderUrl(policy, input.url);
      if (initial.kind === "blocked") {
        return {
          kind: "security-policy-violation",
          code: initial.code,
          blockedUrl: initial.blockedUrl,
          networkAttempts: 0,
        };
      }

      let currentUrl = initial.canonicalUrl;
      let redirectHops = 0;
      let networkAttempts = 0;
      const visited = new Set<string>();
      while (true) {
        visited.add(currentUrl);
        const step = await dependencies.transport.execute(currentUrl);
        networkAttempts += 1;
        if (step.kind === "response") {
          return {
            kind: "success",
            provider: input.provider,
            finalUrl: currentUrl,
            redirectHops,
            responseBytes: step.bodyBytes,
          };
        }
        if (step.kind !== "redirect") {
          throw new Error("Provider scoped fixture는 response와 redirect만 지원합니다.");
        }
        const resolved = new URL(step.location, currentUrl).href;
        redirectHops += 1;
        if (redirectHops > policy.maxRedirectHops || visited.has(resolved)) {
          return {
            kind: "security-policy-violation",
            code: "REDIRECT_LIMIT_EXCEEDED",
            blockedUrl: resolved,
            networkAttempts,
          };
        }
        const validation = validateProviderUrl(policy, resolved);
        if (validation.kind === "blocked") {
          return {
            kind: "security-policy-violation",
            code: validation.code,
            blockedUrl: resolved,
            networkAttempts,
          };
        }
        currentUrl = validation.canonicalUrl;
      }
    },
  };
}
