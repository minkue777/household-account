import type { Firestore } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { FirebaseDividendEventRuntimeRepository } from "../../../src/adapters/firebase/dividends/firebaseDividendEventRuntimeRepository";
import { createDividendScheduledRuntimeApplication } from "../../../src/contexts/portfolio/dividends/application/dividendScheduledRuntimeApplication";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

const quantities = [72, 574, 1286, 400, 855];
const sourceAssetIds = quantities.map((_, i) => `asset-${i}`);
const disclosure = { source: "KIND" as const, sourceDisclosureId: "20260928000552", disclosureState: "active" as const, instrumentCode: "368590", instrumentName: "RISE 미국나스닥100", recordDate: "2026-09-30", paymentDate: "2026-10-02", perShareAmount: 44, disclosedAt: "2026-09-28", sourceReferenceHash: "same-hash" };
const original = { eventId: "event", householdId: "house", sourceDisclosureId: disclosure.sourceDisclosureId, sourceAssetIds, instrumentCode: disclosure.instrumentCode, instrumentName: disclosure.instrumentName, recordDate: disclosure.recordDate, paymentDate: disclosure.paymentDate, perShareAmount: 44, status: "fixed", eligibleQuantity: 2332, totalAmount: 102608, aggregateVersion: 2, sourceReferenceHash: "same-hash",
  eligibilityContributions: quantities.slice(0, 4).map((quantity, i) => ({ assetId: sourceAssetIds[i], snapshotDate: "2026-09-28", observedAt: "2026-09-28T00:00:00Z", sourceVersion: "1", quantity })),
};
function fixture(full: boolean, providerSuccess = true) {
  const db = new InMemoryFirestore();
  db.seed("dividend_events/event", original);
  const events = new FirebaseDividendEventRuntimeRepository(db as unknown as Firestore);
  const target = { targetId: "house:368590", householdId: "house", sourceAssetIds, instrument: { market: "KRX" as const, instrumentType: "ETF" as const, code: disclosure.instrumentCode, name: disclosure.instrumentName, currency: "KRW" as const } };
  const runtime = createDividendScheduledRuntimeApplication({ events,
    holdings: {
      async listActiveKrxEtfTargets() { return { items: [target] }; },
      async listPositionHistory() { return quantities.slice(0, full ? 5 : 4).map((quantity, i) => ({ householdId: "house", assetId: sourceAssetIds[i]!, positionId: `position-${i}`, instrumentCode: disclosure.instrumentCode, snapshotDate: "2026-09-28", observedAt: "2026-09-28T00:00:00Z", sourceVersion: "1", quantity })); },
    },
    disclosures: {
      async discover() { return { kind: "success", attempts: 1, disclosures: [disclosure] }; },
      async recheck() { return providerSuccess ? { kind: "success", attempts: 1, disclosures: [disclosure] } : { kind: "no-data", code: "NO_DISCLOSURES", attempts: 1 }; },
    }, providerObservations: { async record() {}, async finalizeRun() {} },
  });
  const run = () => runtime.runLifecyclePage({ limit: 10, executionKey: "run", asOfDate: "2026-10-02", observedAt: "2026-10-02T10:00:00Z" });
  return { db, events, runtime, target, run };
}
describe("T-DIV-008 DIV-003 DIV-004 DIV-005 DIV-006 전체 계좌 수량 근거", () => {
  it("일부 이력이 빠진 announced를 부분 합계로 확정하지 않는다", async () => {
    const { db, run } = fixture(false);
    db.seed("dividend_events/event", { ...original, status: "announced", aggregateVersion: 1, eligibleQuantity: undefined, totalAmount: undefined, eligibilityContributions: undefined });
    expect((await run()).items[0]).toMatchObject({ kind: "skipped", receipt: "POSITION_HISTORY_INCOMPLETE" });
    expect(db.document("dividend_events/event")?.status).toBe("announced");
  });
  it("같은 공시·hash에서도 부분 fixed를 3187주·140228원으로 정정한다", async () => {
    const { db, run } = fixture(true);
    expect((await run()).items[0]?.kind).toBe("succeeded");
    expect(db.document("dividend_events/event")).toMatchObject({ status: "paid", eligibleQuantity: 3187, totalAmount: 140228, aggregateVersion: 4 });
    expect(db.document("dividend_events/event")?.eligibilityContributions).toHaveLength(5);
    await run();
    expect(db.document("dividend_events/event")?.aggregateVersion).toBe(4);
  });
  it("discovery에서도 동일 공시 fixed의 누락을 복구한다", async () => {
    const { db, runtime } = fixture(true);
    await runtime.runDiscoveryPage({ limit: 10, concurrency: 1, executionKey: "discovery", observedAt: "2026-10-01T10:00:00Z", periodFrom: "2025-10-01", periodTo: "2026-10-01" });
    expect(db.document("dividend_events/event")).toMatchObject({ status: "fixed", eligibleQuantity: 3187, totalAmount: 140228, aggregateVersion: 3 });
  });
  it.each([true, false])("부분 fixed의 누락이 남아 있으면 paid로 전환하지 않는다 (provider=%s)", async success => {
    const { db, run } = fixture(false, success);
    expect((await run()).items[0]).toMatchObject({ code: "POSITION_HISTORY_INCOMPLETE" });
    expect(db.document("dividend_events/event")).toEqual(original);
  });
  it("paid 이벤트는 잘못된 부분 합계라도 자동 변경하지 않는다", async () => {
    const { db, run } = fixture(true);
    db.seed("dividend_events/event", { ...original, status: "paid" });
    expect((await run()).items).toEqual([]);
    expect(db.document("dividend_events/event")).toEqual({ ...original, status: "paid" });
  });
  it("저장소 정정도 부분 증거를 거부하고 원본과 outbox를 보존한다", async () => {
    const { db, events, target } = fixture(true);
    const result = await events.upsertAnnouncement({ target, disclosure, observedAt: "2026-10-01T10:00:00Z", idempotencyKey: "bad", correction: { expectedVersion: 2, eligibleQuantity: 72, evidence: [{ assetId: "asset-0", quantity: 72, snapshotDate: "2026-09-28", observedAt: "2026-09-28T00:00:00Z", sourceVersion: "1", selectionKind: "nearest" }] } });
    expect(result).toMatchObject({ kind: "retryable-failure", code: "POSITION_HISTORY_INCOMPLETE" });
    expect(db.document("dividend_events/event")).toEqual(original);
    expect(db.paths("operationsOutbox/")).toEqual([]);
  });
  it("모든 계좌에 명시적인 0주 근거가 있으면 0원으로 정상 확정한다", async () => {
    const { db, events, target } = fixture(true);
    const evidence = sourceAssetIds.map(assetId => ({ assetId, quantity: 0, snapshotDate: "2026-09-30", observedAt: "2026-09-30T00:00:00Z", sourceVersion: "zero", selectionKind: "exact" as const }));
    expect(await events.upsertAnnouncement({ target, disclosure, observedAt: "2026-10-01T00:00:00Z", idempotencyKey: "zero", correction: { expectedVersion: 2, eligibleQuantity: 0, evidence } })).toMatchObject({ kind: "changed" });
    expect(db.document("dividend_events/event")).toMatchObject({ status: "fixed", eligibleQuantity: 0, totalAmount: 0 });
  });
  it("전체 근거라도 version 경합 또는 수량 합계 불일치는 정정하지 않는다", async () => {
    const { db, events, target } = fixture(true);
    const evidence = sourceAssetIds.map((assetId, i) => ({ assetId, quantity: quantities[i]!, snapshotDate: "2026-09-28", observedAt: "2026-09-28T00:00:00Z", sourceVersion: "1", selectionKind: "nearest" as const }));
    for (const [expectedVersion, eligibleQuantity, code] of [[1, 3187, "DIVIDEND_VERSION_CONFLICT"], [2, 9999, "DIVIDEND_CORRECTION_EVIDENCE_REQUIRED"]] as const) {
      expect(await events.upsertAnnouncement({ target, disclosure, observedAt: "2026-10-01T00:00:00Z", idempotencyKey: code, correction: { expectedVersion, eligibleQuantity, evidence } })).toMatchObject({ kind: "retryable-failure", code });
      expect(db.document("dividend_events/event")).toEqual(original);
    }
  });
});
