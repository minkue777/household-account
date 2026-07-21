import {
  validateProviderUrl,
  type ProviderNetworkPolicy,
} from "../domain/safeHttpPolicy";
import type {
  ProviderHttpOutcome,
  ProviderHttpTarget,
  SafeExternalHttpInputPort,
} from "./ports/in/safeExternalHttpInputPort";
import type { ScriptedHttpTransportPort } from "./ports/out/scriptedHttpTransportPort";

export interface SafeExternalHttpPolicy {
  readonly allowedHttpsHosts: readonly string[];
  readonly allowedPorts: readonly number[];
  readonly timeoutMs: 10_000;
  readonly maxResponseBytes: number;
  readonly maxRedirectHops: number;
  readonly maxConcurrency: 5;
  readonly maxAttempts: 3;
}

function providerPolicy(policy: SafeExternalHttpPolicy): ProviderNetworkPolicy {
  return {
    provider: "batch",
    allowedHosts: policy.allowedHttpsHosts,
    allowedPorts: policy.allowedPorts,
    maxRedirectHops: policy.maxRedirectHops,
  };
}

function initialViolation(
  target: ProviderHttpTarget,
  policy: ProviderNetworkPolicy,
): ProviderHttpOutcome | undefined {
  const validation = validateProviderUrl(policy, target.url);
  if (validation.kind === "allowed") return undefined;
  return {
    targetId: target.targetId,
    kind: "security-policy-violation",
    code:
      validation.code === "HTTPS_REQUIRED"
        ? "HTTPS_REQUIRED"
        : "HOST_NOT_ALLOWED",
    attempts: 0,
  };
}

export function createSafeExternalHttpApplication(dependencies: {
  readonly policy: SafeExternalHttpPolicy;
  readonly transport: ScriptedHttpTransportPort;
}): SafeExternalHttpInputPort {
  const scopedPolicy = providerPolicy(dependencies.policy);

  const executeTarget = async (
    target: ProviderHttpTarget,
  ): Promise<ProviderHttpOutcome> => {
    for (let attempt = 1; attempt <= dependencies.policy.maxAttempts; attempt += 1) {
      let currentUrl = new URL(target.url).href;
      let redirectHops = 0;
      const visited = new Set<string>();
      while (true) {
        visited.add(currentUrl);
        const step = await dependencies.transport.execute(currentUrl);
        if (step.kind === "redirect") {
          const nextUrl = new URL(step.location, currentUrl).href;
          redirectHops += 1;
          const validation = validateProviderUrl(scopedPolicy, nextUrl);
          if (
            validation.kind === "blocked" ||
            redirectHops > dependencies.policy.maxRedirectHops ||
            visited.has(nextUrl)
          ) {
            return {
              targetId: target.targetId,
              kind: "security-policy-violation",
              code: "REDIRECT_NOT_ALLOWED",
              attempts: attempt,
            };
          }
          currentUrl = validation.canonicalUrl;
          continue;
        }
        if (step.kind === "chunked-response") {
          let bytes = 0;
          for (const chunk of step.chunks) {
            bytes += chunk;
            if (bytes > dependencies.policy.maxResponseBytes) {
              return {
                targetId: target.targetId,
                kind: "contract-failure",
                code: "RESPONSE_TOO_LARGE",
                attempts: attempt,
              };
            }
          }
          return {
            targetId: target.targetId,
            kind: "success",
            attempts: attempt,
          };
        }
        if (step.kind === "response") {
          if (step.bodyBytes > dependencies.policy.maxResponseBytes) {
            return {
              targetId: target.targetId,
              kind: "contract-failure",
              code: "RESPONSE_TOO_LARGE",
              attempts: attempt,
            };
          }
          if (step.status === 200) {
            return { targetId: target.targetId, kind: "success", attempts: attempt };
          }
          const retryCode =
            step.status === 429
              ? "RATE_LIMITED"
              : step.status >= 500
                ? "PROVIDER_UNAVAILABLE"
                : undefined;
          if (retryCode !== undefined) {
            if (attempt < dependencies.policy.maxAttempts) break;
            return {
              targetId: target.targetId,
              kind: "retryable-failure",
              code: retryCode,
              attempts: attempt,
            };
          }
          return {
            targetId: target.targetId,
            kind: "contract-failure",
            code: "HTTP_STATUS_NOT_SUPPORTED",
            attempts: attempt,
          };
        }
        if (attempt >= dependencies.policy.maxAttempts) {
          return {
            targetId: target.targetId,
            kind: "retryable-failure",
            code: "TIMEOUT",
            attempts: attempt,
          };
        }
        break;
      }
    }
    throw new Error("bounded retry 결과가 필요합니다.");
  };

  return {
    async executeBatch(targets) {
      const outcomes: ProviderHttpOutcome[] = new Array(targets.length);
      const queuedIndices: number[] = [];
      targets.forEach((target, index) => {
        const violation = initialViolation(target, scopedPolicy);
        if (violation === undefined) queuedIndices.push(index);
        else outcomes[index] = violation;
      });

      let cursor = 0;
      let active = 0;
      let maxObservedConcurrency = 0;
      const workerCount = Math.min(
        dependencies.policy.maxConcurrency,
        queuedIndices.length,
      );
      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          while (cursor < queuedIndices.length) {
            const queueIndex = cursor;
            cursor += 1;
            const targetIndex = queuedIndices[queueIndex]!;
            active += 1;
            maxObservedConcurrency = Math.max(maxObservedConcurrency, active);
            await Promise.resolve();
            outcomes[targetIndex] = await executeTarget(targets[targetIndex]!);
            active -= 1;
          }
        }),
      );
      return { outcomes, maxObservedConcurrency, completed: true };
    },
  };
}
