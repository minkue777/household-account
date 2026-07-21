import { createExternalResultClassificationApplication } from "../../src/platform/external-operations/application/externalResultClassificationApplication";
import type { ExternalResult } from "../../src/platform/external-operations/public";

export function createExternalResultClassificationFixture(fixture: {
  operation?: () => Promise<ExternalResult<number>>;
  maxAttempts?: number;
} = {}) {
  return createExternalResultClassificationApplication({
    operation: {
      execute:
        fixture.operation ??
        (async () => ({ kind: "NO_DATA", reason: "NOT_CONFIGURED" })),
    },
    maxAttempts: fixture.maxAttempts ?? 3,
  });
}
