import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { FirebaseDividendEventRuntimeRepository } from "../../../src/adapters/firebase/dividends/firebaseDividendEventRuntimeRepository";
import { FirebaseDividendProviderObservation } from "../../../src/adapters/firebase/dividends/firebaseDividendProviderObservation";
import { FirebaseDividendHoldingQuery } from "../../../src/adapters/firebase/portfolio/firebaseDividendHoldingQuery";
import { createDividendScheduledRuntimeApplication } from "../../../src/contexts/portfolio/dividends/application/dividendScheduledRuntimeApplication";
import type {
  DividendProviderObservationPort,
  KindDividendDisclosurePort,
} from "../../../src/contexts/portfolio/dividends/application/ports/out/dividendScheduledRuntimePorts";
import { createDividendScheduledPages } from "../../../src/operations/scheduling/dividendScheduledPages";
import { runTrackedScheduledJob } from "../../../src/operations/scheduling/trackedScheduledJob";

const PROJECT_ID = "demo-household-account-dividend-schedule";
const HOUSEHOLD_ID = "household-dividend-test";
const POSITION_ID = "position-etf-1";
const ASSET_ID = "asset-stock-1";
const describeWithFirestoreEmulator = process.env.FIRESTORE_EMULATOR_HOST
  ? describe
  : describe.skip;

let app: App;
let database: Firestore;

async function clearEmulator(): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (host === undefined) return;
  const response = await fetch(
    `http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  if (!response.ok) throw new Error(`Firestore emulator clear failed: ${response.status}`);
}

async function seedPosition(input: {
  readonly positionId?: string;
  readonly assetId?: string;
  readonly market: "KRX" | "US" | "UNRESOLVED";
  readonly instrumentType: "etf" | "stock";
  readonly code: string;
  readonly lifecycleState?: "active" | "deleted";
}) {
  const positionId = input.positionId ?? POSITION_ID;
  const assetId = input.assetId ?? ASSET_ID;
  await database
    .collection("households")
    .doc(HOUSEHOLD_ID)
    .collection("assets")
    .doc(assetId)
    .collection("positions")
    .doc(positionId)
    .set({
      householdId: HOUSEHOLD_ID,
      assetId,
      positionId,
      positionKind: "stock",
      market: input.market,
      currency: input.market === "US" ? "USD" : "KRW",
      instrumentType: input.instrumentType,
      instrumentCode: input.code,
      instrumentName: input.code === "102110" ? "TIGER 200" : input.code,
      instrument: {
        market: input.market,
        instrumentType: input.instrumentType.toLocaleUpperCase("en-US"),
        code: input.code,
        name: input.code === "102110" ? "TIGER 200" : input.code,
        currency: input.market === "US" ? "USD" : "KRW",
      },
      quantity: 10,
      aggregateVersion: 1,
      lifecycleState: input.lifecycleState ?? "active",
      updatedAt: "2026-07-09T23:55:00+09:00",
    });
}

async function seedHistory(
  snapshotDate: string,
  quantity: number,
  instrumentType: "ETF" | "STOCK" = "ETF",
) {
  await database
    .collection("households")
    .doc(HOUSEHOLD_ID)
    .collection("assets")
    .doc(ASSET_ID)
    .collection("positionHistory")
    .doc(`${POSITION_ID}-${snapshotDate}`)
    .set({
      householdId: HOUSEHOLD_ID,
      assetId: ASSET_ID,
      positionId: POSITION_ID,
      instrument: {
        market: "KRX",
        instrumentType,
        code: "102110",
        currency: "KRW",
      },
      snapshotDate,
      quantity,
      observedAt: `${snapshotDate}T23:55:00+09:00`,
      sourceVersion: `position-v${snapshotDate}`,
      operation: "update",
    });
}

function disclosureSource(perShareAmount = 120): KindDividendDisclosurePort {
  return {
    async discover(input) {
      return {
        kind: "success",
        attempts: 1,
        disclosures: [
          {
            source: "KIND",
            sourceDisclosureId: "20260720000123",
            disclosureState: "active",
            instrumentCode: input.instrumentCode,
            instrumentName: input.instrumentName,
            recordDate: "2026-07-10",
            paymentDate: "2026-07-20",
            perShareAmount,
            disclosedAt: "2026-07-09",
            sourceReferenceHash: `hash-${perShareAmount}`,
          },
        ],
      };
    },
  };
}

const noOpObservations: DividendProviderObservationPort = {
  async record() {},
  async finalizeRun() {},
};

describeWithFirestoreEmulator("Firebase dividend hourly vertical slice", () => {
  beforeAll(() => {
    app = initializeApp({ projectId: PROJECT_ID }, `dividend-${Date.now()}`);
    database = getFirestore(app);
  });

  beforeEach(async () => {
    await clearEmulator();
    await database.collection("households").doc(HOUSEHOLD_ID).set({
      lifecycleState: "active",
      aggregateVersion: 1,
    });
  });

  afterAll(async () => {
    if (app !== undefined) await deleteApp(app);
  });

  it("명시적인 active KRX ETF만 discovery 대상으로 공개한다", async () => {
    await seedPosition({ market: "KRX", instrumentType: "etf", code: "102110" });
    await seedPosition({
      positionId: "position-us-etf",
      market: "US",
      instrumentType: "etf",
      code: "SPY",
    });
    await seedPosition({
      positionId: "position-kr-stock",
      market: "KRX",
      instrumentType: "stock",
      code: "005930",
    });
    await seedPosition({
      positionId: "position-unresolved-etf",
      market: "UNRESOLVED",
      instrumentType: "etf",
      code: "069500",
    });
    const page = await new FirebaseDividendHoldingQuery(database)
      .listActiveKrxEtfTargets({ limit: 50 });
    expect(page.items).toEqual([
      expect.objectContaining({
        targetId: `${HOUSEHOLD_ID}:102110`,
        householdId: HOUSEHOLD_ID,
        sourceAssetIds: [ASSET_ID],
        instrument: expect.objectContaining({
          market: "KRX",
          instrumentType: "ETF",
          code: "102110",
        }),
      }),
    ]);
  });

  it("공시번호 한 건을 같은 Event로 교체하고 과거 revision 문서를 만들지 않는다", async () => {
    await seedPosition({ market: "KRX", instrumentType: "etf", code: "102110" });
    const events = new FirebaseDividendEventRuntimeRepository(database);
    const first = createDividendScheduledRuntimeApplication({
      holdings: new FirebaseDividendHoldingQuery(database),
      disclosures: disclosureSource(100),
      events,
      providerObservations: noOpObservations,
    });
    await first.runDiscoveryPage({
      limit: 50,
      concurrency: 5,
      periodFrom: "2025-07-21",
      periodTo: "2026-07-21",
      executionKey: "dividend-hourly:2026-07-21T09",
      observedAt: "2026-07-21T09:00:00+09:00",
    });
    const corrected = createDividendScheduledRuntimeApplication({
      holdings: new FirebaseDividendHoldingQuery(database),
      disclosures: disclosureSource(120),
      events,
      providerObservations: noOpObservations,
    });
    await corrected.runDiscoveryPage({
      limit: 50,
      concurrency: 5,
      periodFrom: "2025-07-21",
      periodTo: "2026-07-21",
      executionKey: "dividend-hourly:2026-07-21T10",
      observedAt: "2026-07-21T10:00:00+09:00",
    });
    const snapshot = await database.collection("dividend_events").get();
    expect(snapshot.size).toBe(1);
    expect(snapshot.docs[0].data()).toMatchObject({
      sourceDisclosureId: "20260720000123",
      perShareAmount: 120,
      aggregateVersion: 2,
      status: "announced",
    });
    expect(
      await database.collection("dividend_event_revisions").get(),
    ).toMatchObject({ empty: true });
  });

  it("holding 삭제 뒤에도 history의 동률 이전 날짜를 골라 fixed·paid로 진행하고 canonical 전체로 projection을 교체한다", async () => {
    await seedPosition({ market: "KRX", instrumentType: "etf", code: "102110" });
    await seedHistory("2026-07-09", 9, "STOCK");
    await seedHistory("2026-07-11", 11, "STOCK");
    const events = new FirebaseDividendEventRuntimeRepository(database);
    const runtime = createDividendScheduledRuntimeApplication({
      holdings: new FirebaseDividendHoldingQuery(database),
      disclosures: disclosureSource(120),
      events,
      providerObservations: noOpObservations,
    });
    await runtime.runDiscoveryPage({
      limit: 50,
      concurrency: 5,
      periodFrom: "2025-07-10",
      periodTo: "2026-07-10",
      executionKey: "dividend-hourly:2026-07-10T09",
      observedAt: "2026-07-10T09:00:00+09:00",
    });
    await database
      .collection("households")
      .doc(HOUSEHOLD_ID)
      .collection("assets")
      .doc(ASSET_ID)
      .collection("positions")
      .doc(POSITION_ID)
      .update({ lifecycleState: "deleted", aggregateVersion: 2 });
    const fixedPage = await runtime.runLifecyclePage({
      limit: 50,
      executionKey: "dividend-hourly:2026-07-10T09",
      asOfDate: "2026-07-10",
      observedAt: "2026-07-10T09:00:00+09:00",
    });
    expect(fixedPage.items).toEqual([
      expect.objectContaining({ kind: "succeeded", receipt: "fixed:v2" }),
    ]);
    let event = (await database.collection("dividend_events").get()).docs[0];
    expect(event.data()).toMatchObject({
      status: "fixed",
      eligibleQuantity: 9,
      totalAmount: 1_080,
      eligibilityContributions: [
        expect.objectContaining({
          snapshotDate: "2026-07-09",
          kind: "nearest-position-snapshot",
          quantity: 9,
        }),
      ],
    });
    await runtime.runLifecyclePage({
      limit: 50,
      executionKey: "dividend-hourly:2026-07-20T09",
      asOfDate: "2026-07-20",
      observedAt: "2026-07-20T09:00:00+09:00",
    });
    event = (await database.collection("dividend_events").get()).docs[0];
    expect(event.data()).toMatchObject({ status: "paid", totalAmount: 1_080 });

    await database.collection("dividend_snapshots").doc(`${HOUSEHOLD_ID}_2026`).set({
      householdId: HOUSEHOLD_ID,
      year: 2026,
      monthlyData: Array.from({ length: 12 }, () => 999),
      events: { stale: { totalAmount: 999 } },
    });
    await events.rebuildAllAnnualProjections({
      sourceCheckpoint: "dividend-hourly:2026-07-20T09",
      observedAt: "2026-07-20T09:00:00+09:00",
    });
    const projection = (
      await database.collection("dividend_snapshots").doc(`${HOUSEHOLD_ID}_2026`).get()
    ).data()!;
    expect(projection.monthlyData[6]).toBe(1_080);
    expect(Object.keys(projection.events)).toEqual([event.data().eventId]);
    expect(projection.events).not.toHaveProperty("stale");

    const target = (
      await new FirebaseDividendHoldingQuery(database).listActiveKrxEtfTargets({ limit: 50 })
    ).items[0];
    expect(target).toBeUndefined();
    const before = event.data();
    const correction = await events.upsertAnnouncement({
      target: {
        targetId: `${HOUSEHOLD_ID}:102110`,
        householdId: HOUSEHOLD_ID,
        instrument: {
          market: "KRX",
          instrumentType: "ETF",
          code: "102110",
          name: "TIGER 200",
          currency: "KRW",
        },
        sourceAssetIds: [ASSET_ID],
      },
      disclosure: {
        source: "KIND",
        sourceDisclosureId: "20260720000123",
        disclosureState: "active",
        instrumentCode: "102110",
        instrumentName: "TIGER 200",
        recordDate: "2026-07-10",
        paymentDate: "2026-07-21",
        perShareAmount: 999,
        disclosedAt: "2026-07-21",
        sourceReferenceHash: "corrected-after-paid",
      },
      observedAt: "2026-07-21T10:00:00+09:00",
      idempotencyKey: "paid-correction",
    });
    expect(correction.kind).toBe("paid-preserved");
    expect((await event.ref.get()).data()).toMatchObject({
      paymentDate: before.paymentDate,
      perShareAmount: before.perShareAmount,
      totalAmount: before.totalAmount,
      status: "paid",
    });
  });

  it("Provider health는 마지막 성공을 보존하고 구조화된 실패·복구 상태를 기록한다", async () => {
    const observations = new FirebaseDividendProviderObservation(database);
    await observations.record({
      executionKey: "run-partial",
      targetId: "instrument:102110",
      resultKind: "SUCCESS",
      attempts: 1,
      observedAt: "2026-07-21T09:00:00+09:00",
    });
    await observations.record({
      executionKey: "run-partial",
      targetId: "instrument:069500",
      resultKind: "CONTRACT_FAILURE",
      errorCode: "HTTP_STATUS_NOT_SUPPORTED",
      attempts: 1,
      httpStatus: 403,
      stage: "search",
      observedAt: "2026-07-21T09:00:00+09:00",
    });
    await observations.finalizeRun({
      executionKey: "run-partial",
      observedAt: "2026-07-21T09:00:00+09:00",
    });
    let health = (await database
      .collection("operations")
      .doc("runtime")
      .collection("providerHealth")
      .get()).docs[0].data();
    expect(health).toMatchObject({
      provider: "KIND",
      operation: "dividend-disclosure",
      status: "degraded",
      lastResultKind: "PARTIAL_FAILURE",
      lastRunTargetCount: 2,
      lastRunSucceededTargets: 1,
      lastRunFailedTargets: 1,
      consecutiveFailedRuns: 0,
      alertState: "closed",
    });

    for (let index = 1; index <= 3; index += 1) {
      const observedAt = `2026-07-21T${String(9 + index).padStart(2, "0")}:00:00+09:00`;
      await observations.record({
        executionKey: `run-failure-${index}`,
        targetId: "instrument:102110",
        resultKind: "RETRYABLE_FAILURE",
        errorCode: "TIMEOUT",
        attempts: 3,
        observedAt,
      });
      await observations.finalizeRun({
        executionKey: `run-failure-${index}`,
        observedAt,
      });
    }
    health = (await database
      .collection("operations")
      .doc("runtime")
      .collection("providerHealth")
      .get()).docs[0].data();
    expect(health).toMatchObject({
      provider: "KIND",
      operation: "dividend-disclosure",
      status: "outage",
      lastSuccessAt: "2026-07-21T09:00:00+09:00",
      consecutiveFailedRuns: 3,
      lastErrorCode: "TIMEOUT",
      alertState: "open",
    });
    await observations.record({
      executionKey: "run-recovered",
      targetId: "instrument:102110",
      resultKind: "NO_DATA",
      errorCode: "NO_DISCLOSURES",
      attempts: 1,
      observedAt: "2026-07-21T13:00:00+09:00",
    });
    await observations.finalizeRun({
      executionKey: "run-recovered",
      observedAt: "2026-07-21T13:00:00+09:00",
    });
    health = (await database
      .collection("operations")
      .doc("runtime")
      .collection("providerHealth")
      .get()).docs[0].data();
    expect(health).toMatchObject({
      status: "healthy",
      lastSuccessAt: "2026-07-21T13:00:00+09:00",
      consecutiveFailedRuns: 0,
      alertState: "closed",
    });
  });

  it("discovery와 lifecycle checkpoint를 분리하고 terminal page에서 tracked JobRun을 완료한다", async () => {
    const result = await runTrackedScheduledJob({
      database,
      request: {
        jobName: "dividend-hourly",
        scheduledFor: "2026-07-21T00:00:00.000Z",
        workerId: "dividend-emulator-worker",
        pages: createDividendScheduledPages({
          database,
          executionKey: "dividend-hourly:2026-07-21T09",
          asOfDate: "2026-07-21",
          periodFrom: "2025-07-21",
          periodTo: "2026-07-21",
          observedAt: "2026-07-21T00:00:00.000Z",
          pageSize: 50,
          resolveKrxEtfCodes: async () => new Set(),
        }),
      },
    });
    expect(result).toMatchObject({
      jobName: "dividend-hourly",
      status: "COMPLETE",
      checkpoint: "dividend:complete",
      totals: { target: 1, succeeded: 1, skipped: 0, failed: 0 },
    });
    const run = (
      await database
        .collection("operations")
        .doc("runtime")
        .collection("scheduledJobRuns")
        .get()
    ).docs[0].data();
    expect(run).toMatchObject({
      jobName: "dividend-hourly",
      status: "COMPLETE",
      checkpoint: "dividend:complete",
    });
  });

  it("종목 카탈로그가 ETF로 분류한 기존 stock 저장값을 배당 대상으로 복구한다", async () => {
    await seedPosition({
      positionId: "legacy-etf-position",
      market: "KRX",
      instrumentType: "stock",
      code: "102110",
    });
    await seedPosition({
      positionId: "ordinary-stock-position",
      market: "KRX",
      instrumentType: "stock",
      code: "005930",
    });

    const page = await new FirebaseDividendHoldingQuery(
      database,
      async () => new Set(["102110"]),
    ).listActiveKrxEtfTargets({ limit: 50 });

    expect(page.items).toEqual([
      expect.objectContaining({
        targetId: `${HOUSEHOLD_ID}:102110`,
        instrument: expect.objectContaining({
          instrumentType: "ETF",
          code: "102110",
        }),
      }),
    ]);
  });

  it("같은 KIND 문서에 포함된 서로 다른 ETF 배당을 별도 이벤트로 보존한다", async () => {
    const events = new FirebaseDividendEventRuntimeRepository(database);
    const target = (code: string, assetId: string) => ({
      targetId: `${HOUSEHOLD_ID}:${code}`,
      householdId: HOUSEHOLD_ID,
      instrument: {
        market: "KRX" as const,
        instrumentType: "ETF" as const,
        code,
        name: code,
        currency: "KRW" as const,
      },
      sourceAssetIds: [assetId],
    });
    const disclosure = (code: string, amount: number, sourceId = "shared-document") => ({
      source: "KIND" as const,
      sourceDisclosureId: sourceId,
      disclosureState: "active" as const,
      instrumentCode: code,
      instrumentName: code,
      recordDate: "2026-07-30",
      paymentDate: "2026-08-03",
      perShareAmount: amount,
      disclosedAt: "2026-07-29",
      sourceReferenceHash: `${sourceId}-${code}-${amount}`,
    });

    await events.upsertAnnouncement({
      target: target("102110", "asset-a"),
      disclosure: disclosure("102110", 255),
      observedAt: "2026-07-29T09:00:00+09:00",
      idempotencyKey: "same-kind-document-a",
    });
    await events.upsertAnnouncement({
      target: target("069500", "asset-b"),
      disclosure: disclosure("069500", 83),
      observedAt: "2026-07-29T09:00:00+09:00",
      idempotencyKey: "same-kind-document-b",
    });

    let snapshot = await database.collection("dividend_events").get();
    expect(snapshot.size).toBe(2);
    expect(
      snapshot.docs.map((document) => document.data().instrumentCode).sort(),
    ).toEqual(["069500", "102110"]);

    await events.upsertAnnouncement({
      target: target("102110", "asset-a"),
      disclosure: disclosure("102110", 260),
      observedAt: "2026-07-29T10:00:00+09:00",
      idempotencyKey: "same-kind-document-a-correction",
    });
    snapshot = await database.collection("dividend_events").get();
    expect(snapshot.size).toBe(2);
    expect(
      snapshot.docs.find(
        (document) => document.data().instrumentCode === "102110",
      )?.data(),
    ).toMatchObject({ perShareAmount: 260, aggregateVersion: 2 });
  });

  it("같은 종목과 같은 사실이어도 서로 다른 KIND 문서는 별도 이벤트다", async () => {
    const events = new FirebaseDividendEventRuntimeRepository(database);
    const target = {
      targetId: `${HOUSEHOLD_ID}:102110`,
      householdId: HOUSEHOLD_ID,
      instrument: {
        market: "KRX" as const,
        instrumentType: "ETF" as const,
        code: "102110",
        name: "TIGER 200",
        currency: "KRW" as const,
      },
      sourceAssetIds: [ASSET_ID],
    };
    const baseDisclosure = {
      source: "KIND" as const,
      disclosureState: "active" as const,
      instrumentCode: "102110",
      instrumentName: "TIGER 200",
      recordDate: "2026-07-30",
      paymentDate: "2026-08-03",
      perShareAmount: 255,
      disclosedAt: "2026-07-29",
    };
    await events.upsertAnnouncement({
      target,
      disclosure: {
        ...baseDisclosure,
        sourceDisclosureId: "kind-document-a",
        sourceReferenceHash: "kind-document-a-hash",
      },
      observedAt: "2026-07-29T09:00:00+09:00",
      idempotencyKey: "different-kind-document-a",
    });
    await events.upsertAnnouncement({
      target,
      disclosure: {
        ...baseDisclosure,
        sourceDisclosureId: "kind-document-b",
        sourceReferenceHash: "kind-document-b-hash",
      },
      observedAt: "2026-07-29T10:00:00+09:00",
      idempotencyKey: "different-kind-document-b",
    });

    expect((await database.collection("dividend_events").get()).size).toBe(2);
  });
});
