import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { FirebaseAssetAutomationRuntimeStore } from "../../../src/adapters/firebase/portfolio/firebaseAssetAutomationRuntimeStore";
import { createAssetAutomationScheduledApplication } from "../../../src/contexts/portfolio/automation/public";
import { createAssetAutomationScheduledPages } from "../../../src/operations/scheduling/assetAutomationScheduledPages";

const PROJECT_ID = "demo-household-account-asset-automation";
const HOUSEHOLD_ID = "household-automation-test";
const ASSET_ID = "asset-automation-test";
const PLAN_ID = `${ASSET_ID}_savings-contribution`;
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

async function seed(input: {
  readonly operation?: "savings-contribution" | "loan-repayment";
  readonly nextDueDate?: string;
  readonly balance?: number;
  readonly revision?: boolean;
}) {
  const operation = input.operation ?? "savings-contribution";
  const planId = `${ASSET_ID}_${operation}`;
  const household = database.collection("households").doc(HOUSEHOLD_ID);
  const asset = {
    assetId: ASSET_ID,
    householdId: HOUSEHOLD_ID,
    name: "자동화 자산",
    type: operation === "loan-repayment" ? "loan" : "savings",
    subType: operation === "loan-repayment" ? "credit" : "installment",
    ownerRef: { kind: "household" },
    currency: "KRW",
    currentBalance: input.balance ?? 1_000_000,
    memo: "",
    order: 0,
    lifecycleState: "active",
    aggregateVersion: 3,
    automation: {},
    schemaVersion: 1,
    createdAt: "2025-12-01T00:00:00.000Z",
    updatedAt: "2025-12-01T00:00:00.000Z",
  };
  await Promise.all([
    household.set({ lifecycleState: "active", aggregateVersion: 1 }),
    household.collection("assets").doc(ASSET_ID).set(asset),
    database.collection("assets").doc(ASSET_ID).set({
      ...asset,
      isActive: true,
      subType: operation === "loan-repayment" ? "신용대출" : "적금",
    }),
    household.collection("assetAutomationPlans").doc(planId).set({
      planId,
      householdId: HOUSEHOLD_ID,
      assetId: ASSET_ID,
      operation,
      kind: operation === "loan-repayment" ? "loan-repayment" : "savings-deposit",
      status: "active",
      amountInWon: 100_000,
      configuredDay: 18,
      firstActivatedOn: "2025-12-01",
      firstApplicableMonth: "2026-01",
      activationMonthDisposition: "applicable",
      nextDueDate: input.nextDueDate ?? "2026-01-18",
      currentRevision: 1,
      aggregateVersion: 1,
      createdAt: "2025-12-01T00:00:00.000Z",
      updatedAt: "2025-12-01T00:00:00.000Z",
      schemaVersion: 1,
    }),
  ]);
  if (input.revision !== false) {
    await household
      .collection("assetAutomationPlanRevisions")
      .doc(`${planId}_1`)
      .set({
        revisionId: `${planId}_1`,
        planId,
        householdId: HOUSEHOLD_ID,
        assetId: ASSET_ID,
        operation,
        revision: 1,
        effectiveFrom: "2025-12-01T00:00:00.000Z",
        amountInWon: operation === "loan-repayment" ? 10_000 : 100_000,
        configuredDay: 18,
        ...(operation === "loan-repayment"
          ? {
              annualInterestRate: 5,
              repaymentMethod: "equal-principal-and-interest",
            }
          : {}),
        schemaVersion: 1,
      });
  }
  return { household, planId };
}

describeWithFirestoreEmulator("Firebase asset automation scheduled runtime", () => {
  beforeAll(() => {
    app = initializeApp({ projectId: PROJECT_ID }, `asset-automation-${Date.now()}`);
    database = getFirestore(app);
  });

  beforeEach(clearEmulator);

  afterAll(async () => {
    if (app !== undefined) await deleteApp(app);
  });

  it("여러 누락 월을 oldest-first로 적용하고 Asset·Plan·claim·receipt·Outbox·legacy projection을 함께 commit한다", async () => {
    const { household } = await seed({});
    const store = new FirebaseAssetAutomationRuntimeStore(database);
    const result = await createAssetAutomationScheduledApplication({ store }).processPage({
      occurrenceId: "asset-automation-daily:2026-03-20",
      asOfDate: "2026-03-20",
      processedAt: "2026-03-19T15:00:00.000Z",
      limit: 100,
    });

    expect(result.results.map((entry) => entry.kind)).toEqual([
      "applied",
      "applied",
      "applied",
    ]);
    expect(
      (await household.collection("assets").doc(ASSET_ID).get()).data(),
    ).toMatchObject({
      currentBalance: 1_300_000,
      aggregateVersion: 6,
      lastAutoContributionMonth: "2026-03",
      automation: { lastAutoContributionMonth: "2026-03" },
    });
    expect((await database.collection("assets").doc(ASSET_ID).get()).data()).toMatchObject({
      currentBalance: 1_300_000,
      aggregateVersion: 6,
      lastAutoContributionMonth: "2026-03",
    });
    expect((await household.collection("assetAutomationPlans").doc(PLAN_ID).get()).data()).toMatchObject({
      lastAppliedMonth: "2026-03",
      nextDueDate: "2026-04-18",
      aggregateVersion: 4,
    });
    expect((await household.collection("assetAutomationExecutions").get()).size).toBe(3);
    expect((await household.collection("assetAutomationExecutionReceipts").get()).size).toBe(3);
    expect((await database.collection("outboxEvents").get()).size).toBe(6);
  });

  it("Scheduler page checkpoint가 target 상한 뒤 같은 Plan을 이어 처리하고 빈 마지막 page를 terminal로 닫는다", async () => {
    await seed({});
    const pages = createAssetAutomationScheduledPages({
      database,
      occurrenceId: "asset-automation-daily:2026-03-20",
      asOfDate: "2026-03-20",
      processedAt: "2026-03-19T15:00:00.000Z",
      pageSize: 2,
    });

    const first = await pages.nextPage();
    expect(first).toMatchObject({
      targets: [{ outcome: { kind: "SUCCEEDED" } }, { outcome: { kind: "SUCCEEDED" } }],
    });
    expect(first?.terminal).not.toBe(true);
    expect(first?.checkpointAfter).toEqual(expect.any(String));

    const second = await pages.nextPage(first?.checkpointAfter);
    expect(second).toMatchObject({
      checkpointBefore: first?.checkpointAfter,
      targets: [{ outcome: { kind: "SUCCEEDED" } }],
    });
    expect(second?.terminal).not.toBe(true);

    const terminal = await pages.nextPage(second?.checkpointAfter);
    expect(terminal).toEqual({
      checkpointBefore: second?.checkpointAfter,
      checkpointAfter: "asset-automation:complete",
      terminal: true,
      targets: [],
    });
    expect(await pages.nextPage(terminal?.checkpointAfter)).toBeUndefined();
  });

  it("같은 월 동시 실행은 create-only claim 하나와 already-processed 하나로 수렴한다", async () => {
    await seed({ nextDueDate: "2026-07-18" });
    const store = new FirebaseAssetAutomationRuntimeStore(database);
    const due = await store.listDuePlans({
      asOfDate: "2026-07-18",
      limit: 1,
    });
    const target = due.plans[0];
    const outcomes = await Promise.all([
      store.applyNextDue({
        plan: target,
        asOfDate: "2026-07-18",
        occurrenceId: "run-a",
        processedAt: "2026-07-17T15:00:00.000Z",
      }),
      store.applyNextDue({
        plan: target,
        asOfDate: "2026-07-18",
        occurrenceId: "run-b",
        processedAt: "2026-07-17T15:00:00.000Z",
      }),
    ]);

    expect(outcomes.map(({ kind }) => kind).sort()).toEqual([
      "already-processed",
      "applied",
    ]);
    const household = database.collection("households").doc(HOUSEHOLD_ID);
    expect((await household.collection("assetAutomationExecutions").get()).size).toBe(1);
    expect((await household.collection("assets").doc(ASSET_ID).get()).data()?.currentBalance).toBe(1_100_000);
  });

  it("원리금균등 대출은 현재 잔액 기준 원금만 차감하고 잘못된 revision은 needs-attention으로 격리한다", async () => {
    const loan = await seed({
      operation: "loan-repayment",
      nextDueDate: "2026-07-18",
      balance: 100_000,
    });
    const store = new FirebaseAssetAutomationRuntimeStore(database);
    const due = await store.listDuePlans({ asOfDate: "2026-07-18", limit: 1 });
    expect(
      await store.applyNextDue({
        plan: due.plans[0],
        asOfDate: "2026-07-18",
        occurrenceId: "loan-run",
        processedAt: "2026-07-17T15:00:00.000Z",
      }),
    ).toMatchObject({ kind: "applied", targetMonth: "2026-07" });
    expect((await loan.household.collection("assets").doc(ASSET_ID).get()).data()?.currentBalance).toBe(90_417);

    await clearEmulator();
    const invalid = await seed({ nextDueDate: "2026-07-18", revision: false });
    const invalidDue = await store.listDuePlans({ asOfDate: "2026-07-18", limit: 1 });
    expect(
      await store.applyNextDue({
        plan: invalidDue.plans[0],
        asOfDate: "2026-07-18",
        occurrenceId: "invalid-run",
        processedAt: "2026-07-17T15:00:00.000Z",
      }),
    ).toEqual({
      kind: "needs-attention",
      targetId: `${HOUSEHOLD_ID}:${ASSET_ID}:savings-contribution:2026-07`,
      code: "AUTOMATION_REVISION_NOT_FOUND",
    });
    expect((await invalid.household.collection("assetAutomationPlans").doc(invalid.planId).get()).data()).toMatchObject({
      status: "needs-attention",
      attentionCode: "AUTOMATION_REVISION_NOT_FOUND",
      nextDueDate: "2026-07-18",
    });
  });

  it("keeps an overdue month on the revision effective at its due instant", async () => {
    const { household, planId } = await seed({ nextDueDate: "2026-07-18" });
    await Promise.all([
      household.collection("assetAutomationPlans").doc(planId).update({
        amountInWon: 200_000,
        configuredDay: 25,
        currentRevision: 2,
        updatedAt: "2026-07-20T03:00:00.000Z",
      }),
      household
        .collection("assetAutomationPlanRevisions")
        .doc(`${planId}_2`)
        .set({
          revisionId: `${planId}_2`,
          planId,
          householdId: HOUSEHOLD_ID,
          assetId: ASSET_ID,
          operation: "savings-contribution",
          revision: 2,
          effectiveFrom: "2026-07-20T03:00:00.000Z",
          amountInWon: 200_000,
          configuredDay: 25,
          schemaVersion: 1,
        }),
    ]);

    const store = new FirebaseAssetAutomationRuntimeStore(database);
    const due = await store.listDuePlans({ asOfDate: "2026-07-20", limit: 1 });
    expect(
      await store.applyNextDue({
        plan: due.plans[0],
        asOfDate: "2026-07-20",
        occurrenceId: "revision-boundary-run",
        processedAt: "2026-07-20T04:00:00.000Z",
      }),
    ).toMatchObject({ kind: "applied", targetMonth: "2026-07" });

    expect((await household.collection("assets").doc(ASSET_ID).get()).data()).toMatchObject({
      currentBalance: 1_100_000,
    });
    expect((await household.collection("assetAutomationPlans").doc(planId).get()).data()).toMatchObject({
      lastAppliedMonth: "2026-07",
      nextDueDate: "2026-08-25",
      currentRevision: 2,
    });
    const executions = await household.collection("assetAutomationExecutions").get();
    expect(executions.docs[0]?.data()).toMatchObject({
      targetMonth: "2026-07",
      appliedRevision: 1,
      appliedAmountInWon: 100_000,
    });
  });
});
