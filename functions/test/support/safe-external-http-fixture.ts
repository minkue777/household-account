import {
  createSafeExternalHttpApplication,
  type SafeExternalHttpPolicy,
} from "../../src/platform/external-operations/application/safeExternalHttpApplication";
import type { SafeHttpTransportStep } from "../../src/platform/external-operations/application/ports/out/scriptedHttpTransportPort";

export function createSafeExternalHttpFixture(input: {
  policy: SafeExternalHttpPolicy;
  scripts: Readonly<Record<string, readonly SafeHttpTransportStep[]>>;
}) {
  const offsets = new Map<string, number>();
  return createSafeExternalHttpApplication({
    policy: input.policy,
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
