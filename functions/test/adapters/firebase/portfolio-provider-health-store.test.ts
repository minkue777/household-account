import type * as firestore from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { FirebasePortfolioProviderHealthStore } from "../../../src/adapters/firebase/portfolio/firebasePortfolioProviderHealthStore";
import type { PortfolioProviderRunObservation } from "../../../src/contexts/portfolio/core/application/ports/out/portfolioRuntimeStorePort";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

function failureRun(sequence: number): PortfolioProviderRunObservation {
  return {
    provider: "naver-domestic",
    operation: "market-quote",
    executionKey: `command-${sequence}:asset:private-asset-id:naver-domestic`,
    expectedData: true,
    observedAt: `2026-07-2${sequence}T14:55:00.000Z`,
    attempts: [1, 2, 3].map((attempt) => ({
      resultKind: "RETRYABLE_FAILURE" as const,
      errorCode: "PROVIDER_UNAVAILABLE",
      attempt,
      latencyMs: 10,
    })),
    finalResult: {
      kind: "RETRYABLE_FAILURE",
      code: "PROVIDER_UNAVAILABLE",
    },
  };
}

describe("Firebase portfolio provider health store", () => {
  it("records one failed run after internal retries, opens on the third run, and resolves on success without household identifiers", async () => {
    const memory = new InMemoryFirestore();
    const store = new FirebasePortfolioProviderHealthStore(
      memory as unknown as firestore.Firestore,
      "projects/test/notificationChannels/provider-email",
    );

    await store.recordRun(failureRun(1));
    await store.recordRun(failureRun(2));
    await store.recordRun(failureRun(3));

    const healthPath = memory.paths("operations/runtime/providerHealth/")[0];
    expect(healthPath).toBeDefined();
    expect(memory.document(healthPath)).toMatchObject({
      provider: "naver-domestic",
      operation: "market-quote",
      status: "outage",
      consecutiveFailedRuns: 3,
      lastResultKind: "RETRYABLE_FAILURE",
      alertState: "open",
      version: 3,
    });
    expect(memory.paths("operations/runtime/providerHealthReceipts/")).toHaveLength(3);
    expect(JSON.stringify(memory.document(healthPath))).not.toContain("private-asset-id");
    expect(JSON.stringify(memory.document(healthPath))).not.toContain("householdId");

    await store.recordRun({
      provider: "naver-domestic",
      operation: "market-quote",
      executionKey: "command-4:asset:private-asset-id:naver-domestic",
      expectedData: true,
      observedAt: "2026-07-24T14:55:00.000Z",
      attempts: [
        {
          resultKind: "SUCCESS",
          attempt: 1,
          latencyMs: 8,
        },
      ],
      finalResult: {
        kind: "SUCCESS",
        quote: {
          priceInWon: 70_000,
          observedAt: "2026-07-24T14:54:59.000Z",
        },
      },
    });

    expect(memory.document(healthPath)).toMatchObject({
      status: "healthy",
      consecutiveFailedRuns: 0,
      lastResultKind: "SUCCESS",
      alertState: "closed",
      recoveredAt: "2026-07-24T14:55:00.000Z",
      version: 4,
    });
    expect(memory.paths("operations/runtime/providerHealthReceipts/")).toHaveLength(4);
  });
});
