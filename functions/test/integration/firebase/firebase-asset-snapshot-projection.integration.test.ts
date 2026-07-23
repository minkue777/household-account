import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  FirebaseAssetSnapshotProjectionSource,
  FirebaseAssetSnapshotProjectionStore,
} from "../../../src/adapters/firebase/portfolio/firebaseAssetSnapshotProjection";
import { FirebasePortfolioRuntimeStore } from "../../../src/adapters/firebase/portfolio/firebasePortfolioRuntimeStore";
import { createAssetSnapshotProjectionApplication } from "../../../src/contexts/portfolio/core/application/assetSnapshotProjectionApplication";
import { createAssetValuationScheduledPages } from "../../../src/operations/scheduling/assetValuationScheduledPages";
import { runTrackedScheduledJob } from "../../../src/operations/scheduling/trackedScheduledJob";

const PROJECT_ID = "demo-household-account-asset-snapshot";
const HOUSEHOLD_ID = "household-snapshot-test";
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
  if (!response.ok) {
    throw new Error(`Firestore emulator clear failed: ${response.status}`);
  }
}

async function seedAsset(input: {
  readonly assetId: string;
  readonly type: "stock" | "loan";
  readonly balance: number;
  readonly ownerRef:
    | { readonly kind: "household" }
    | { readonly kind: "profile"; readonly profileId: string };
  readonly ownerDisplayName: string;
}): Promise<void> {
  await database
    .collection("households")
    .doc(HOUSEHOLD_ID)
    .collection("assets")
    .doc(input.assetId)
    .set({
      householdId: HOUSEHOLD_ID,
      assetId: input.assetId,
      name: input.assetId,
      type: input.type,
      ownerRef: input.ownerRef,
      owner: input.ownerDisplayName,
      currency: "KRW",
      currentBalance: input.balance,
      memo: "",
      order: 0,
      lifecycleState: "active",
      aggregateVersion: 1,
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
    });
}

describeWithFirestoreEmulator("Firebase AssetSnapshot projector", () => {
  beforeAll(() => {
    app = initializeApp({ projectId: PROJECT_ID }, PROJECT_ID);
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

  it("canonical 현재·직전 scope 합집합과 legacy 호환 projection을 같은 날짜 key로 멱등 저장합니다", async () => {
    await database
      .collection("households")
      .doc(HOUSEHOLD_ID)
      .collection("assetOwnerProfiles")
      .doc("child")
      .set({
        householdId: HOUSEHOLD_ID,
        displayName: "아이",
        lifecycleState: "active",
      });
    await seedAsset({
      assetId: "asset-stock",
      type: "stock",
      balance: 100,
      ownerRef: { kind: "profile", profileId: "child" },
      ownerDisplayName: "아이",
    });
    await seedAsset({
      assetId: "asset-loan",
      type: "loan",
      balance: 30,
      ownerRef: { kind: "household" },
      ownerDisplayName: "가구",
    });
    await database
      .collection("households")
      .doc(HOUSEHOLD_ID)
      .collection("assetSnapshots")
      .doc("2026-07-20")
      .set({
        schemaVersion: 1,
        householdId: HOUSEHOLD_ID,
        localDate: "2026-07-20",
        total: 500,
        financial: 400,
        byType: { stock: 400, bond: 100 },
        byOwnerRefKey: { "profile:archived": 500 },
        ownerDisplayNames: { "profile:archived": "과거 명의자" },
      });

    const runtime = new FirebasePortfolioRuntimeStore(database);
    const subject = createAssetSnapshotProjectionApplication({
      source: new FirebaseAssetSnapshotProjectionSource(runtime),
      store: new FirebaseAssetSnapshotProjectionStore(database),
    });
    const command = {
      householdId: HOUSEHOLD_ID,
      localDate: "2026-07-21",
      sourceCheckpoint: "asset-valuation-daily:2026-07-21:household",
      calculatedAt: "2026-07-21T14:55:00.000Z",
    } as const;

    const first = await subject.project(command);
    const replay = await subject.project(command);

    expect(first.kind).toBe("projected");
    expect(replay.kind).toBe("replayed");
    const canonical = (
      await database
        .collection("households")
        .doc(HOUSEHOLD_ID)
        .collection("assetSnapshots")
        .doc("2026-07-21")
        .get()
    ).data();
    expect(canonical).toMatchObject({
      schemaVersion: 1,
      total: 70,
      financial: 100,
      byType: { stock: 100, loan: -30, bond: 0 },
      byOwnerRefKey: {
        household: -30,
        "profile:child": 100,
        "profile:archived": 0,
      },
      ownerDisplayNames: {
        household: "가구",
        "profile:child": "아이",
        "profile:archived": "과거 명의자",
      },
      freshness: "fresh",
    });
    expect(
      (
        await database
          .collection("asset_history")
          .doc(`${HOUSEHOLD_ID}_total_2026-07-21`)
          .get()
      ).data(),
    ).toMatchObject({
      assetId: "TOTAL",
      balance: 70,
      changeAmount: -430,
      date: "2026-07-21",
    });
    expect(
      (
        await database
          .collection("asset_history")
          .doc(
            `${HOUSEHOLD_ID}_owner_${encodeURIComponent("과거 명의자")}_2026-07-21`,
          )
          .get()
      ).data(),
    ).toMatchObject({ assetId: "OWNER_과거 명의자", balance: 0 });
  });

  it("[T-AST-004][AST-008] 첫 canonical snapshot은 직전 legacy snapshot을 변동액 기준으로 사용합니다", async () => {
    await seedAsset({
      assetId: "asset-stock",
      type: "stock",
      balance: 120,
      ownerRef: { kind: "profile", profileId: "child" },
      ownerDisplayName: "아이",
    });
    const previousDate = "2026-07-20";
    const previousDocuments = [
      { suffix: "total", assetId: "TOTAL", balance: 100 },
      { suffix: "financial", assetId: "FINANCIAL", balance: 100 },
      { suffix: "type_stock", assetId: "TYPE_stock", balance: 100 },
      {
        suffix: `owner_${encodeURIComponent("아이")}`,
        assetId: "OWNER_아이",
        balance: 100,
      },
    ];
    await Promise.all(
      previousDocuments.map(({ suffix, assetId, balance }) =>
        database
          .collection("asset_history")
          .doc(`${HOUSEHOLD_ID}_${suffix}_${previousDate}`)
          .set({
            householdId: HOUSEHOLD_ID,
            assetId,
            balance,
            changeAmount: 0,
            date: previousDate,
          }),
      ),
    );

    const subject = createAssetSnapshotProjectionApplication({
      source: new FirebaseAssetSnapshotProjectionSource(
        new FirebasePortfolioRuntimeStore(database),
      ),
      store: new FirebaseAssetSnapshotProjectionStore(database),
    });
    const result = await subject.project({
      householdId: HOUSEHOLD_ID,
      localDate: "2026-07-21",
      sourceCheckpoint: "asset-valuation-daily:2026-07-21:first-canonical",
      calculatedAt: "2026-07-21T14:55:00.000Z",
    });

    expect(result.kind).toBe("projected");
    for (const suffix of ["total", "financial", "type_stock"]) {
      expect(
        (
          await database
            .collection("asset_history")
            .doc(`${HOUSEHOLD_ID}_${suffix}_2026-07-21`)
            .get()
        ).data(),
      ).toMatchObject({ changeAmount: 20 });
    }
    expect(
      (
        await database
          .collection("asset_history")
          .doc(
            `${HOUSEHOLD_ID}_owner_${encodeURIComponent("아이")}_2026-07-21`,
          )
          .get()
      ).data(),
    ).toMatchObject({ changeAmount: 20 });
  });

  it("tracked refresh phase 완료 뒤 snapshot phase로 전이해 JobRun을 terminal 완료합니다", async () => {
    const scheduledFor = new Date().toISOString();
    const result = await runTrackedScheduledJob({
      database,
      request: {
        jobName: "asset-valuation-daily",
        scheduledFor,
        workerId: "asset-valuation-emulator:invocation-1",
        pages: createAssetValuationScheduledPages(
          {
            database,
            executionKey: `asset-valuation-daily:${scheduledFor.slice(0, 10)}`,
            scheduledFor,
            asOfDate: scheduledFor.slice(0, 10),
          },
          {
            households: {
              async next(afterHouseholdId) {
                return afterHouseholdId === undefined
                  ? { householdId: HOUSEHOLD_ID, active: true }
                  : undefined;
              },
            },
            refresh: {
              async refreshMarketValues() {
                return {
                  kind: "success",
                  value: {
                    refreshedCount: 0,
                    targetCount: 0,
                    retainedLastSuccessCount: 0,
                  },
                };
              },
            },
            snapshots: {
              async project(input) {
                return {
                  kind: "projected",
                  snapshot: {
                    schemaVersion: 1,
                    householdId: input.householdId,
                    localDate: input.localDate,
                    total: 0,
                    financial: 0,
                    byType: {
                      savings: 0,
                      stock: 0,
                      crypto: 0,
                      property: 0,
                      gold: 0,
                      loan: 0,
                    },
                    byOwnerRefKey: {},
                    ownerDisplayNames: {},
                    sourceAssetVersions: {},
                    sourceCheckpoint: input.sourceCheckpoint,
                    calculatedAt: input.calculatedAt,
                  },
                };
              },
            },
          },
        ),
      },
    });

    expect(result).toMatchObject({
      jobName: "asset-valuation-daily",
      status: "COMPLETE",
      checkpoint: "asset-valuation:complete",
      totals: { target: 4, succeeded: 4, skipped: 0, failed: 0 },
    });
    const runs = await database
      .collection("operations")
      .doc("runtime")
      .collection("scheduledJobRuns")
      .get();
    expect(runs.docs[0].data()).toMatchObject({
      jobName: "asset-valuation-daily",
      status: "COMPLETE",
      checkpoint: "asset-valuation:complete",
    });
  });
});
