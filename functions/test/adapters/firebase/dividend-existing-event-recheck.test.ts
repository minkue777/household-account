import type { Firestore } from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";
import { FirebaseDividendEventRuntimeRepository } from "../../../src/adapters/firebase/dividends/firebaseDividendEventRuntimeRepository";
import { createDividendScheduledRuntimeApplication } from "../../../src/contexts/portfolio/dividends/application/dividendScheduledRuntimeApplication";
import type { KindDividendDiscoveryResult } from "../../../src/contexts/portfolio/dividends/application/ports/out/dividendScheduledRuntimePorts";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

const original = { eventId: "event-stable", householdId: "household", sourceDisclosureId: "20260901000123", sourceAssetIds: ["asset"], instrumentCode: "ETF", instrumentName: "ETF", recordDate: "2026-09-01", paymentDate: "2026-09-20", perShareAmount: 100, status: "fixed", eligibleQuantity: 3, totalAmount: 300, aggregateVersion: 2, sourceReferenceHash: "old" };
const corrected = { source: "KIND" as const, sourceDisclosureId: original.sourceDisclosureId, disclosureState: "active" as const, instrumentCode: "ETF", instrumentName: "ETF", recordDate: "2026-09-05", paymentDate: "2026-09-20", perShareAmount: 200, disclosedAt: "2026-09-06", sourceReferenceHash: "corrected" };

function fixture(result: KindDividendDiscoveryResult, hasHistory = true) {
  const database = new InMemoryFirestore();
  database.seed("dividend_events/event", original);
  const recheck = vi.fn(async () => result);
  const runtime = createDividendScheduledRuntimeApplication({
    events: new FirebaseDividendEventRuntimeRepository(database as unknown as Firestore),
    holdings: {
      async listActiveKrxEtfTargets() { return { items: [] }; },
      async listPositionHistory() { return hasHistory ? [{ householdId: "household", assetId: "asset", positionId: "position", instrumentCode: "ETF", snapshotDate: "2026-09-05", quantity: 9, observedAt: "2026-09-05T00:00:00Z", sourceVersion: "v5" }] : []; },
    },
    disclosures: { recheck, async discover() { return { kind: "no-data", code: "NO_DISCLOSURES", attempts: 1 }; } },
    providerObservations: { async record() {}, async finalizeRun() {} },
  });
  const run = () => runtime.runLifecyclePage({ limit: 10, executionKey: "recheck", asOfDate: "2026-09-20", observedAt: "2026-09-20T00:00:00Z" });
  return { database, recheck, run };
}

describe("보유종목 삭제 후 기존 배당 공시 재확인", () => {
  it("저장된 공시 번호로 정정 금액과 새 기준일 수량을 반영한 뒤 지급하고 재실행에 중복 반영하지 않는다", async () => {
    const subject = fixture({ kind: "success", disclosures: [corrected], attempts: 1 });
    await subject.run();
    expect(subject.recheck).toHaveBeenCalledWith({ sourceDisclosureId: original.sourceDisclosureId, instrumentCode: "ETF", instrumentName: "ETF" });
    expect(subject.database.document("dividend_events/event")).toMatchObject({ status: "paid", eligibleQuantity: 9, totalAmount: 1800, aggregateVersion: 4 });
    await subject.run();
    expect(subject.database.document("dividend_events/event")).toMatchObject({ aggregateVersion: 4 });
    expect(subject.recheck).toHaveBeenCalledTimes(1);
  });
  it("명시적 취소 결과만 기존 미지급 이벤트를 제거한다", async () => {
    const subject = fixture({ kind: "success", disclosures: [{ ...corrected, disclosureState: "cancelled" }], attempts: 1 });
    await subject.run();
    expect(subject.database.document("dividend_events/event")).toBeUndefined();
  });
  it("공시 재조회 중 취소된 이벤트는 재생성하지 않는다", async () => {
    const subject = fixture({ kind: "success", disclosures: [corrected], attempts: 1 });
    subject.recheck.mockImplementationOnce(async () => {
      subject.database.remove("dividend_events/event");
      return { kind: "success", disclosures: [corrected], attempts: 1 };
    });
    expect((await subject.run()).items[0]).toMatchObject({ kind: "failed", code: "DIVIDEND_EVENT_NOT_FOUND" });
    expect(subject.database.document("dividend_events/event")).toBeUndefined();
    expect((await subject.run()).items).toEqual([]);
  });
  it("announced 이벤트도 정정된 기준일의 근거로 확정 후 지급한다", async () => {
    const subject = fixture({ kind: "success", disclosures: [corrected], attempts: 1 });
    subject.database.seed("dividend_events/event", { ...original, status: "announced", eligibleQuantity: undefined, totalAmount: undefined, aggregateVersion: 1 });
    await subject.run();
    expect(subject.database.document("dividend_events/event")).toMatchObject({ status: "paid", eligibleQuantity: 9, totalAmount: 1800, aggregateVersion: 4 });
  });
  it("eventId가 없는 구형 문서도 읽기에서 부여한 동일 identity로 확인한 뒤 정정·지급한다", async () => {
    const subject = fixture({ kind: "success", disclosures: [corrected], attempts: 1 });
    const { eventId: _eventId, ...legacy } = original;
    subject.database.seed("dividend_events/event", legacy);
    expect((await subject.run()).items[0]?.kind).toBe("succeeded");
    expect(subject.database.document("dividend_events/event")).toMatchObject({ status: "paid", eligibleQuantity: 9, totalAmount: 1800, aggregateVersion: 4 });
    expect(subject.database.document("dividend_events/event")?.eventId).toEqual(expect.any(String));
  });
  it.each([
    { kind: "no-data" as const, code: "NO_DISCLOSURES", attempts: 1 },
    { kind: "retryable-failure" as const, code: "TIMEOUT", attempts: 3 },
    { kind: "contract-failure" as const, code: "HTTP_STATUS_NOT_SUPPORTED", attempts: 1 },
  ])("$kind는 기존 사실을 보존하며 정상 생애주기를 진행한다", async result => {
    const subject = fixture(result);
    await subject.run();
    expect(subject.database.document("dividend_events/event")).toMatchObject({ status: "paid", eligibleQuantity: 3, totalAmount: 300 });
  });
  it("정정을 확인했지만 근거가 없으면 이전 금액으로 지급하지 않는다", async () => {
    const subject = fixture({ kind: "success", disclosures: [corrected], attempts: 1 }, false);
    expect((await subject.run()).items[0]).toMatchObject({ kind: "failed", code: "POSITION_HISTORY_NOT_OBSERVED" });
    expect(subject.database.document("dividend_events/event")).toEqual(original);
  });
});
