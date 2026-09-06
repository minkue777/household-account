import type { Firestore } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { FirebaseDividendEventRuntimeRepository } from "../../../src/adapters/firebase/dividends/firebaseDividendEventRuntimeRepository";
import { createDividendScheduledRuntimeApplication } from "../../../src/contexts/portfolio/dividends/application/dividendScheduledRuntimeApplication";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

describe("Dividend discovery through the Firebase repository", () => {
  it.each([true, false])("corrects a fixed event atomically only when new-date evidence exists (%s)", async (hasHistory) => {
    const database = new InMemoryFirestore();
    const target = { targetId: "household:ETF", householdId: "household", sourceAssetIds: ["asset"], instrument: { market: "KRX" as const, instrumentType: "ETF" as const, code: "ETF", name: "ETF", currency: "KRW" as const } };
    const original = { eventId: "event-stable", householdId: "household", sourceDisclosureId: "disclosure", sourceAssetIds: ["asset"], instrumentCode: "ETF", instrumentName: "ETF", recordDate: "2026-09-01", paymentDate: "2026-09-20", perShareAmount: 100, status: "fixed", eligibleQuantity: 3, totalAmount: 300, aggregateVersion: 2, sourceReferenceHash: "old", eligibilityContributions: [{ assetId: "asset", snapshotDate: "2026-09-01", quantity: 3 }] };
    database.seed("dividend_events/event", original);
    const runtime = createDividendScheduledRuntimeApplication({
      events: new FirebaseDividendEventRuntimeRepository(database as unknown as Firestore),
      holdings: {
        async listActiveKrxEtfTargets() { return { items: [target] }; },
        async listPositionHistory() { return hasHistory ? [{ householdId: "household", assetId: "asset", positionId: "position", instrumentCode: "ETF", snapshotDate: "2026-09-05", quantity: 9, observedAt: "2026-09-05T00:00:00Z", sourceVersion: "v5" }] : []; },
      },
      disclosures: { async discover() { return { kind: "success", attempts: 1, disclosures: [{ source: "KIND", sourceDisclosureId: "disclosure", disclosureState: "active", instrumentCode: "ETF", instrumentName: "ETF", recordDate: "2026-09-05", paymentDate: "2026-09-20", perShareAmount: 200, disclosedAt: "2026-09-06", sourceReferenceHash: "corrected" }] }; } },
      providerObservations: { async record() {}, async finalizeRun() {} },
    });
    const result = await runtime.runDiscoveryPage({ limit: 10, concurrency: 1, periodFrom: "2025-09-06", periodTo: "2026-09-06", executionKey: "correction", observedAt: "2026-09-06T00:00:00Z" });
    if (hasHistory) {
      expect(database.document("dividend_events/event")).toMatchObject({ eventId: "event-stable", recordDate: "2026-09-05", perShareAmount: 200, eligibleQuantity: 9, totalAmount: 1800, aggregateVersion: 3, eligibilityContributions: [expect.objectContaining({ snapshotDate: "2026-09-05", quantity: 9, sourceVersion: "v5" })] });
      expect(result.items[0]?.kind).toBe("succeeded");
    } else {
      expect(database.document("dividend_events/event")).toEqual(original);
      expect(result.items[0]).toMatchObject({ kind: "failed", retryable: true, code: "POSITION_HISTORY_NOT_OBSERVED" });
    }
  });
});
