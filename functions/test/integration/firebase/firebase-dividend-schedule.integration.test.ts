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
  readonly market: "KRX" | "US" | "UNRESOLVED";
  readonly instrumentType: "etf" | "stock";
  readonly code: string;
  readonly lifecycleState?: "active" | "deleted";
}) {
  const positionId = input.positionId ?? POSITION_ID;
  await database
    .collection("households")
    .doc(HOUSEHOLD_ID)
    .collection("assets")
    .doc(ASSET_ID)
    .collection("positions")
    .doc(positionId)
    .set({
      householdId: HOUSEHOLD_ID,
      assetId: ASSET_ID,
      positionId,
      positionKind: "stock",
      market: input.market,
      currency: input.market === "US" ? "USD" : "KRW",
      instrumentType: input.instrumentType,
      instrumentCode: input.code,
      instrumentName: input.code === "102110" ? "TIGER 200" : input.code,
      quantity: 10,
      aggregateVersion: 1,
      lifecycleState: input.lifecycleState ?? "active",
      updatedAt: "2026-07-09T23:55:00+09:00",
    });
}

async function seedHistory(snapshotDate: string, quantity: number) {
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
        instrumentType: "etf",
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
    await seedHistory("2026-07-09", 9);
    await seedHistory("2026-07-11", 11);
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
      executionKey: "run-success",
      targetId: `${HOUSEHOLD_ID}:102110`,
      resultKind: "SUCCESS",
      attempts: 1,
      observedAt: "2026-07-21T09:00:00+09:00",
    });
    for (let index = 1; index <= 3; index += 1) {
      await observations.record({
        executionKey: `run-failure-${index}`,
        targetId: `${HOUSEHOLD_ID}:102110`,
        resultKind: "RETRYABLE_FAILURE",
        errorCode: "TIMEOUT",
        attempts: 3,
        observedAt: `2026-07-21T${String(9 + index).padStart(2, "0")}:00:00+09:00`,
      });
    }
    let health = (await database
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
      targetId: `${HOUSEHOLD_ID}:102110`,
      resultKind: "NO_DATA",
      errorCode: "NO_DISCLOSURES",
      attempts: 1,
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
});
