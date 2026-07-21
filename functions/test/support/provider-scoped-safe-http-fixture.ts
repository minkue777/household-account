import { createProviderScopedSafeHttpApplication } from "../../src/platform/external-operations/application/providerScopedSafeHttpApplication";
import type { SafeHttpTransportStep } from "../../src/platform/external-operations/application/ports/out/scriptedHttpTransportPort";
import type { ProviderNetworkPolicy } from "../../src/platform/external-operations/public";

export function createProviderScopedSafeHttpFixture(input: {
  policies: readonly ProviderNetworkPolicy[];
  scripts: Readonly<Record<string, readonly SafeHttpTransportStep[]>>;
}) {
  const offsets = new Map<string, number>();
  return createProviderScopedSafeHttpApplication({
    policies: input.policies,
    transport: {
      async execute(url) {
        const steps = input.scripts[url];
        const offset = offsets.get(url) ?? 0;
        const step = steps?.[offset] ?? steps?.at(-1);
        if (step === undefined) throw new Error(`HTTP fixture가 없습니다: ${url}`);
        offsets.set(url, offset + 1);
        return structuredClone(step);
      },
    },
  });
}
