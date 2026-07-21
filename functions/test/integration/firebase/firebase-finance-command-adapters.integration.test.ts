import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createCategoryHouseholdCommandHandlers } from "../../../src/bootstrap/commands/categoryHouseholdCommandHandlers";
import { createLedgerHouseholdCommandHandlers } from "../../../src/bootstrap/commands/ledgerHouseholdCommandHandlers";
import { createRecurringHouseholdCommandHandlers } from "../../../src/bootstrap/commands/recurringHouseholdCommandHandlers";
import { FirebaseRecurringFinanceUnitOfWork } from "../../../src/adapters/firebase/recurring/firebaseRecurringFinanceUnitOfWork";
import { createRecurringSchedulerWorkflowApplication } from "../../../src/contexts/household-finance/recurring/application/recurringSchedulerWorkflowApplication";
import { createRecurringScheduledPages } from "../../../src/operations/scheduling/recurringScheduledPages";
import type {
  HouseholdCommandActor,
  HouseholdCommandExecutionContext,
} from "../../../src/bootstrap/commands/householdCommand";

const PROJECT_ID = "demo-household-account-finance-command-adapters";
const HOUSEHOLD_ID = "household-finance-command-test";
const REQUESTED_AT = "2026-07-21T09:00:00.000Z";
const describeWithFirestoreEmulator = process.env.FIRESTORE_EMULATOR_HOST
  ? describe
  : describe.skip;

let app: App;
let database: Firestore;

const actor: HouseholdCommandActor = {
  principalUid: "uid-finance-member",
  householdId: HOUSEHOLD_ID,
  actingMemberId: "member-finance",
  capabilities: ["household.read", "household.write"],
};

function context(input: {
  command: string;
  commandId: string;
  payload: Record<string, unknown>;
}): HouseholdCommandExecutionContext {
  return {
    principalUid: actor.principalUid,
    requestedAt: REQUESTED_AT,
    actor,
    envelope: {
      contractVersion: "household-command.v1",
      command: input.command,
      commandId: input.commandId,
      idempotencyKey: input.commandId,
      householdId: HOUSEHOLD_ID,
      payload: input.payload,
    },
  };
}

async function clearEmulator(): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (host === undefined) return;
  const response = await fetch(
    `http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  if (!response.ok) throw new Error(`Firestore emulator clear failed: ${response.status}`);
}

async function execute(
  handlers: ReadonlyMap<string, { execute(context: HouseholdCommandExecutionContext): Promise<unknown> }>,
  command: string,
  commandId: string,
  payload: Record<string, unknown>,
) {
  return handlers.get(command)!.execute(context({ command, commandId, payload }));
}

describeWithFirestoreEmulator("Firebase finance command adapters", () => {
  beforeAll(() => {
    app = initializeApp({ projectId: PROJECT_ID }, `finance-commands-${Date.now()}`);
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

  it("카테고리 6개 command가 같은 catalog 계약과 projection을 원자적으로 갱신한다", async () => {
    const handlers = createCategoryHouseholdCommandHandlers(database);
    const first = (await execute(handlers, "category.create.v1", "category-create-1", {
      category: {
        key: "client-key-1",
        label: "생활비",
        color: "#123456",
        budget: 100_000,
        order: 0,
        isActive: true,
      },
    })) as { categoryId: string };
    const second = (await execute(handlers, "category.create.v1", "category-create-2", {
      category: {
        key: "client-key-2",
        label: "취미",
        color: "#654321",
        budget: null,
        order: 1,
        isActive: true,
      },
    })) as { categoryId: string };

    await execute(handlers, "category.set-default.v1", "category-default-1", {
      categoryId: first.categoryId,
    });
    await execute(handlers, "category.update.v1", "category-update-1", {
      categoryId: second.categoryId,
      changes: { label: "여가", color: "#ABCDEF" },
    });
    await execute(handlers, "category.set-budget.v1", "category-budget-1", {
      categoryId: second.categoryId,
      budget: 55_000,
    });
    await execute(handlers, "category.reorder.v1", "category-reorder-1", {
      categories: [
        { categoryId: second.categoryId, order: 0 },
        { categoryId: first.categoryId, order: 1 },
      ],
    });
    await execute(handlers, "category.archive.v1", "category-archive-1", {
      categoryId: second.categoryId,
    });

    const household = database.collection("households").doc(HOUSEHOLD_ID);
    expect((await household.get()).data()).toMatchObject({
      defaultCategoryKey: first.categoryId,
    });
    expect(
      (await household.collection("categories").doc(second.categoryId).get()).data(),
    ).toMatchObject({
      name: "여가",
      color: "#ABCDEF",
      budgetInWon: 55_000,
      state: "archive-pending",
      sortOrder: 0,
    });
    expect(
      (await database.collection("categories").doc(second.categoryId).get()).data(),
    ).toMatchObject({ isActive: false, label: "여가", budget: 55_000 });
    expect((await household.collection("categoryArchiveProcesses").get()).size).toBe(1);
    expect(
      (
        await database
          .collection("commandReceipts")
          .doc("household-finance-category-catalog")
          .collection("receipts")
          .get()
      ).size,
    ).toBe(7);
  });

  it("기존 legacy category의 문서 ID와 업무 key가 달라도 중복 문서 없이 canonical로 확장한다", async () => {
    await database.collection("categories").doc("legacy-category-document").set({
      householdId: HOUSEHOLD_ID,
      key: "legacy-category-key",
      label: "기존 이름",
      color: "#111111",
      budget: null,
      order: 0,
      isActive: true,
      isDefault: true,
    });
    await database.collection("households").doc(HOUSEHOLD_ID).set(
      { defaultCategoryKey: "legacy-category-key" },
      { merge: true },
    );
    const handlers = createCategoryHouseholdCommandHandlers(database);
    await execute(handlers, "category.update.v1", "legacy-category-update", {
      categoryId: "legacy-category-document",
      changes: { label: "바뀐 이름" },
    });
    expect(
      (await database.collection("categories").doc("legacy-category-document").get()).data(),
    ).toMatchObject({ key: "legacy-category-key", label: "바뀐 이름" });
    expect(
      await database.collection("categories").doc("legacy-category-key").get(),
    ).toMatchObject({ exists: false });
    expect(
      (
        await database
          .collection("households")
          .doc(HOUSEHOLD_ID)
          .collection("categories")
          .doc("legacy-category-key")
          .get()
      ).data(),
    ).toMatchObject({ categoryId: "legacy-category-key", name: "바뀐 이름" });
  });

  it("정기지출 create/update/delete가 creator, version, tombstone, Outbox를 보존한다", async () => {
    const categoryId = "category-recurring";
    await database
      .collection("categories")
      .doc("legacy-recurring-category-document")
      .set({
        householdId: HOUSEHOLD_ID,
        key: categoryId,
        label: "정기",
        color: "#112233",
        budget: null,
        isActive: true,
        order: 0,
      });
    const handlers = createRecurringHouseholdCommandHandlers(database);
    const created = (await execute(
      handlers,
      "recurring.create-plan.v1",
      "recurring-create-1",
      {
        plan: {
          merchant: "통신비",
          amount: 50_000,
          category: categoryId,
          dayOfMonth: 25,
          memo: "휴대폰",
        },
      },
    )) as { planId: string };
    await execute(handlers, "recurring.update-plan.v1", "recurring-update-1", {
      planId: created.planId,
      changes: { amount: 55_000, dayOfMonth: 27, isActive: true },
    });
    await execute(handlers, "recurring.delete-plan.v1", "recurring-delete-1", {
      planId: created.planId,
    });

    const plan = await database
      .collection("households")
      .doc(HOUSEHOLD_ID)
      .collection("recurringPlans")
      .doc(created.planId)
      .get();
    expect(plan.data()).toMatchObject({
      creatorMemberId: actor.actingMemberId,
      amountInWon: 55_000,
      dayOfMonth: 27,
      lifecycleState: "deleted",
      aggregateVersion: 3,
    });
    expect(
      await database.collection("recurring_expenses").doc(created.planId).get(),
    ).toMatchObject({ exists: false });
    expect(
      (
        await database
          .collection("households")
          .doc(HOUSEHOLD_ID)
          .collection("recurringCommandReceipts")
          .get()
      ).size,
    ).toBe(3);
    const outbox = await database
      .collection("outboxEvents")
      .where("aggregateId", "==", created.planId)
      .get();
    expect(outbox.docs.map((snapshot) => snapshot.data().eventType)).toEqual([
      "RecurringPlanChanged",
      "RecurringPlanChanged",
      "RecurringPlanChanged",
    ]);
  });

  it("병합과 원복은 원본 lineage를 보존하고 version을 낙관적으로 증가시킨다", async () => {
    const household = database.collection("households").doc(HOUSEHOLD_ID);
    for (const [transactionId, amountInWon] of [
      ["expense-a", 40_000],
      ["expense-b", 60_000],
    ] as const) {
      await household.collection("ledgerTransactions").doc(transactionId).set({
        householdId: HOUSEHOLD_ID,
        transactionType: "expense",
        lifecycleState: "active",
        amountInWon,
        merchant: transactionId === "expense-a" ? "대상" : "원본",
        categoryId: "etc",
        memo: "",
        accountingDate: "2026-07-21",
        localTime: "12:00",
        cardDisplay: "카드(1234)",
        aggregateVersion: 1,
        source: "manual",
        originChannel: "web",
        creatorMemberId: actor.actingMemberId,
        cardEvidence: "카드(1234)",
        captureLineageId: `lineage-${transactionId}`,
      });
    }
    const handlers = createLedgerHouseholdCommandHandlers(database);
    await execute(handlers, "ledger.merge-transactions.v1", "merge-command-1", {
      targetTransactionId: "expense-a",
      sourceTransactionId: "expense-b",
      expectedVersions: { "expense-a": 1, "expense-b": 1 },
    });
    const mergedId = "merged:merge-command-1";
    expect((await household.collection("ledgerTransactions").doc(mergedId).get()).data()).toMatchObject({
      amountInWon: 100_000,
      lifecycleState: "active",
      aggregateVersion: 1,
      mergeLeafIds: ["expense-a", "expense-b"],
    });
    expect(await database.collection("expenses").doc("expense-a").get()).toMatchObject({
      exists: false,
    });
    expect(await database.collection("expenses").doc("expense-b").get()).toMatchObject({
      exists: false,
    });

    const restored = (await execute(
      handlers,
      "ledger.unmerge-transaction.v1",
      "unmerge-command-1",
      { transactionId: mergedId, expectedVersion: 1 },
    )) as { transactionIds: string[] };
    expect(restored.transactionIds).toEqual(["expense-a", "expense-b"]);
    expect((await household.collection("ledgerTransactions").doc("expense-a").get()).data()).toMatchObject({
      lifecycleState: "active",
      aggregateVersion: 3,
    });
    expect((await household.collection("ledgerTransactions").doc("expense-b").get()).data()).toMatchObject({
      lifecycleState: "active",
      aggregateVersion: 3,
    });
    expect((await household.collection("ledgerTransactions").doc(mergedId).get()).data()).toMatchObject({
      lifecycleState: "deleted",
      aggregateVersion: 2,
    });
    expect(
      (await database.collection("expenses").doc("expense-a").get()).data(),
    ).toMatchObject({ lifecycleState: "active", aggregateVersion: 3 });
    expect(
      (await database.collection("expenses").doc("expense-b").get()).data(),
    ).toMatchObject({ lifecycleState: "active", aggregateVersion: 3 });
    expect(await database.collection("expenses").doc(mergedId).get()).toMatchObject({
      exists: false,
    });
  });

  it("00:00 정기지출 UoW는 planId:YYYY-MM 단위로 원장·checkpoint·receipt·Outbox를 한 번만 commit한다", async () => {
    const household = database.collection("households").doc(HOUSEHOLD_ID);
    const planId = "recurring-midnight-plan";
    const plan = {
      householdId: HOUSEHOLD_ID,
      planId,
      merchant: "월 정기지출",
      amountInWon: 33_000,
      amount: 33_000,
      categoryId: "etc",
      category: "etc",
      dayOfMonth: 21,
      memo: "자동",
      active: true,
      isActive: true,
      creatorMemberId: actor.actingMemberId,
      firstApplicableMonth: "2026-07",
      lifecycleState: "active",
      version: 1,
      aggregateVersion: 1,
    };
    await household.collection("recurringPlans").doc(planId).set(plan);
    await database.collection("recurring_expenses").doc(planId).set(plan);
    const application = createRecurringSchedulerWorkflowApplication({
      unitOfWork: new FirebaseRecurringFinanceUnitOfWork(database),
      clock: { now: () => REQUESTED_AT, localDate: () => "2026-07-21" },
      ids: {
        transactionId: (key) => `recurring-ledger-${hashForTest(key)}`,
        eventId: (key, eventType) => `${hashForTest(key)}-${eventType}`,
      },
      events: { async publish() {} },
    });
    const input = {
      actor: { kind: "system" as const, capabilities: ["recurring.process"] as const },
      householdId: HOUSEHOLD_ID,
      planId,
      targetMonth: "2026-07",
    };
    const first = await application.processMonth(input);
    const replay = await application.processMonth(input);
    expect(first.kind).toBe("created");
    expect(replay.kind).toBe("already-processed");
    if (first.kind !== "created") throw new Error("expected recurring creation");
    expect(
      (await household.collection("ledgerTransactions").doc(first.ledgerTransactionId).get()).data(),
    ).toMatchObject({
      recurringPlanId: planId,
      recurringTargetMonth: "2026-07",
      creatorMemberId: actor.actingMemberId,
      amountInWon: 33_000,
    });
    expect((await household.collection("recurringPlans").doc(planId).get()).data()).toMatchObject({
      lastProcessedMonth: "2026-07",
      lastExecutionKey: `${planId}:2026-07`,
      processingCheckpointVersion: 1,
    });
    expect((await household.collection("recurringExecutions").get()).size).toBe(1);
    expect((await household.collection("recurringExecutionReceipts").get()).size).toBe(1);
    const outbox = await database
      .collection("outboxEvents")
      .where("correlationId", "==", `${planId}:2026-07`)
      .get();
    expect(outbox.docs.map((snapshot) => snapshot.data().eventType).sort()).toEqual([
      "RecurringPlanProcessed",
      "TransactionRecorded",
    ]);
    const pages = createRecurringScheduledPages({
      database,
      asOfDate: "2026-07-21",
      processedAt: REQUESTED_AT,
      pageSize: 100,
    });
    const replayPage = await pages.nextPage();
    expect(replayPage).toMatchObject({
      checkpointAfter: "recurring:complete",
      targets: [
        {
          targetId: `${planId}:2026-07`,
          outcome: { kind: "SKIPPED", receipt: first.ledgerTransactionId },
        },
      ],
    });
    expect(await pages.nextPage("recurring:complete")).toBeUndefined();
  });
});

function hashForTest(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}
