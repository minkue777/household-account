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

  it("수동 거래의 canonical·legacy 카드 표시를 모두 수동으로 기록한다", async () => {
    await database.collection("categories").doc("food").set({
      householdId: HOUSEHOLD_ID,
      key: "food",
      label: "식비",
      isActive: true,
    });
    const handlers = createLedgerHouseholdCommandHandlers(database);
    const result = (await execute(
      handlers,
      "ledger.record-manual-transaction.v1",
      "manual-card-display-1",
      {
        transactionType: "expense",
        merchant: "수동 가맹점",
        amountInWon: 10_000,
        categoryId: "food",
        accountingDate: "2026-07-22",
      },
    )) as { transactionId: string };

    const canonical = await database
      .collection("households")
      .doc(HOUSEHOLD_ID)
      .collection("ledgerTransactions")
      .doc(result.transactionId)
      .get();
    const legacy = await database.collection("expenses").doc(result.transactionId).get();

    expect(canonical.data()).toMatchObject({ cardType: "manual", cardDisplay: "수동" });
    expect(legacy.data()).toMatchObject({
      cardType: "manual",
      cardDisplay: "수동",
      cardLastFour: "수동",
    });
  });

  it("월 분할은 대량 원장에서도 변경 항목만 저장하고 보이는 파생 version만으로 취소한다", async () => {
    const household = database.collection("households").doc(HOUSEHOLD_ID);
    const canonical = household.collection("ledgerTransactions");
    const seed = database.batch();
    for (let index = 0; index < 260; index += 1) {
      seed.set(canonical.doc(`unrelated-${index}`), {
        householdId: HOUSEHOLD_ID,
        transactionType: "expense",
        lifecycleState: "active",
        amountInWon: 1_000 + index,
        accountingDate: "2026-07-01",
        merchant: `무관 거래 ${index}`,
        categoryId: "etc",
        memo: "",
        cardType: "manual",
        cardDisplay: "수동",
        creatorMemberId: actor.actingMemberId,
        source: "manual",
        originChannel: "web",
        aggregateVersion: 1,
      });
    }
    seed.set(canonical.doc("forest"), {
      householdId: HOUSEHOLD_ID,
      transactionType: "expense",
      lifecycleState: "active",
      amountInWon: 20_000,
      accountingDate: "2026-07-28",
      merchant: "포레스트",
      categoryId: "etc",
      memo: "",
      cardType: "captured",
      cardDisplay: "국민(0027)",
      creatorMemberId: actor.actingMemberId,
      source: "notification",
      originChannel: "android",
      aggregateVersion: 1,
    });
    await seed.commit();

    const handlers = createLedgerHouseholdCommandHandlers(database);
    const split = (await execute(
      handlers,
      "ledger.split-existing-transaction-monthly.v1",
      "forest-split-2",
      { transactionId: "forest", expectedVersion: 1, months: 2 },
    )) as { transactionIds: string[]; splitGroupId: string };

    expect(split.transactionIds).toHaveLength(2);
    expect((await canonical.doc("forest").get()).data()).toMatchObject({
      lifecycleState: "superseded",
      aggregateVersion: 2,
    });
    const parts = await Promise.all(
      split.transactionIds.map((transactionId) => canonical.doc(transactionId).get()),
    );
    expect(parts.every((part) => part.exists)).toBe(true);

    await execute(
      handlers,
      "ledger.cancel-monthly-split.v1",
      "forest-collapse",
      {
        splitGroupId: split.splitGroupId,
        expectedVersions: Object.fromEntries(
          parts.map((part) => [part.id, part.data()?.aggregateVersion]),
        ),
      },
    );

    expect((await canonical.doc("forest").get()).data()).toMatchObject({
      lifecycleState: "active",
      aggregateVersion: 3,
      merchant: "포레스트",
      amountInWon: 20_000,
    });
    for (const transactionId of split.transactionIds) {
      expect((await canonical.doc(transactionId).get()).exists).toBe(false);
      expect(
        (await database.collection("expenses").doc(transactionId).get()).exists,
      ).toBe(false);
    }
    expect((await canonical.doc("unrelated-259").get()).data()).toMatchObject({
      aggregateVersion: 1,
      merchant: "무관 거래 259",
    });
  });

  it("지출 나누기는 대량 원장을 읽거나 재저장하지 않고 원본과 파생 항목만 변경한다", async () => {
    await database.collection("categories").doc("food").set({
      householdId: HOUSEHOLD_ID,
      key: "food",
      label: "식비",
      isActive: true,
    });
    const household = database.collection("households").doc(HOUSEHOLD_ID);
    const canonical = household.collection("ledgerTransactions");
    const seed = database.batch();
    for (let index = 0; index < 260; index += 1) {
      seed.set(canonical.doc(`unrelated-item-${index}`), {
        householdId: HOUSEHOLD_ID,
        transactionType: "expense",
        lifecycleState: "active",
        amountInWon: 1_000 + index,
        accountingDate: "2026-07-01",
        localTime: "10:00",
        merchant: `무관 항목 ${index}`,
        categoryId: "food",
        memo: "",
        cardType: "manual",
        cardDisplay: "수동",
        creatorMemberId: actor.actingMemberId,
        source: "manual",
        originChannel: "web",
        aggregateVersion: 1,
      });
    }
    seed.set(canonical.doc("item-split-source"), {
      householdId: HOUSEHOLD_ID,
      transactionType: "expense",
      lifecycleState: "active",
      amountInWon: 20_000,
      accountingDate: "2026-07-28",
      localTime: "14:00",
      merchant: "나누기 원본",
      categoryId: "food",
      memo: "",
      cardType: "captured",
      cardDisplay: "국민(0027)",
      creatorMemberId: actor.actingMemberId,
      source: "notification",
      originChannel: "android",
      aggregateVersion: 1,
    });
    await seed.commit();

    const result = (await execute(
      createLedgerHouseholdCommandHandlers(database),
      "ledger.split-transaction.v1",
      "item-split-large-ledger",
      {
        transactionId: "item-split-source",
        expectedVersion: 1,
        items: [
          {
            merchant: "첫 번째 항목",
            amountInWon: 12_000,
            categoryId: "food",
            memo: "",
          },
          {
            merchant: "두 번째 항목",
            amountInWon: 8_000,
            categoryId: "food",
            memo: "",
          },
        ],
      },
    )) as { transactionIds: string[] };

    expect(result.transactionIds).toHaveLength(2);
    expect((await canonical.doc("item-split-source").get()).data()).toMatchObject({
      lifecycleState: "superseded",
      aggregateVersion: 2,
    });
    expect((await canonical.doc(result.transactionIds[0]).get()).data()).toMatchObject({
      merchant: "첫 번째 항목",
      amountInWon: 12_000,
      derivedFromTransactionId: "item-split-source",
    });
    expect((await canonical.doc(result.transactionIds[1]).get()).data()).toMatchObject({
      merchant: "두 번째 항목",
      amountInWon: 8_000,
      derivedFromTransactionId: "item-split-source",
    });
    expect((await canonical.doc("unrelated-item-259").get()).data()).toMatchObject({
      aggregateVersion: 1,
      merchant: "무관 항목 259",
    });
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
        accountingDate:
          transactionId === "expense-a" ? "2026-07-21" : "2026-07-20",
        localTime: transactionId === "expense-a" ? "12:00" : "09:30",
        cardDisplay:
          transactionId === "expense-a" ? "target-card" : "source-card",
        cardType:
          transactionId === "expense-a" ? "local_currency" : "captured",
        aggregateVersion: 1,
        source: "manual",
        originChannel: "web",
        creatorMemberId: actor.actingMemberId,
        cardEvidence: "카드(1234)",
        captureLineageId: `lineage-${transactionId}`,
      });
    }
    const handlers = createLedgerHouseholdCommandHandlers(database);
    const mergedResponse = (await execute(
      handlers,
      "ledger.merge-transactions.v1",
      "merge-command-1",
      {
        targetTransactionId: "expense-a",
        sourceTransactionId: "expense-b",
        expectedVersions: { "expense-a": 1, "expense-b": 1 },
      },
    )) as {
      transactionId: string;
      transaction: Record<string, unknown>;
    };
    const mergedId = "merged:merge-command-1";
    expect(mergedResponse).toMatchObject({
      transactionId: mergedId,
      transaction: {
        transactionId: mergedId,
        householdId: HOUSEHOLD_ID,
        transactionType: "expense",
        amountInWon: 100_000,
        accountingDate: "2026-07-21",
        localTime: "12:00",
        cardDisplay: "target-card",
        cardType: "local_currency",
        lifecycleState: "active",
        aggregateVersion: 1,
        mergeLeafIds: ["expense-a", "expense-b"],
      },
    });
    expect((await household.collection("ledgerTransactions").doc(mergedId).get()).data()).toMatchObject({
      transactionType: "expense",
      amountInWon: 100_000,
      accountingDate: "2026-07-21",
      localTime: "12:00",
      cardDisplay: "target-card",
      cardType: "local_currency",
      lifecycleState: "active",
      aggregateVersion: 1,
      mergeLeafIds: ["expense-a", "expense-b"],
    });
    const mergedLegacy = (
      await database.collection("expenses").doc(mergedId).get()
    ).data();
    expect(mergedLegacy).toMatchObject({
      transactionType: "expense",
      cardType: "local_currency",
      mergeLeafIds: ["expense-a", "expense-b"],
    });
    expect(mergedLegacy?.mergedFrom).toEqual([
      expect.objectContaining({ amount: 40_000, category: "etc" }),
      expect.objectContaining({ amount: 60_000, category: "etc" }),
    ]);
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
      transactionType: "expense",
      accountingDate: "2026-07-21",
      localTime: "12:00",
      cardDisplay: "target-card",
      cardType: "local_currency",
    });
    expect((await household.collection("ledgerTransactions").doc("expense-b").get()).data()).toMatchObject({
      lifecycleState: "active",
      aggregateVersion: 3,
      transactionType: "expense",
      accountingDate: "2026-07-21",
      localTime: "12:00",
      cardDisplay: "target-card",
      cardType: "local_currency",
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

  it("연속 병합은 leaf ID와 표시 snapshot을 평탄화하고 최종 병합 해제에서 원본을 복원한다", async () => {
    const household = database.collection("households").doc(HOUSEHOLD_ID);
    const batch = database.batch();
    for (const [transactionId, amountInWon] of [
      ["A", 1_000],
      ["B", 2_000],
      ["C", 3_000],
    ] as const) {
      batch.set(household.collection("ledgerTransactions").doc(transactionId), {
        householdId: HOUSEHOLD_ID,
        transactionType: "expense",
        lifecycleState: "active",
        amountInWon,
        merchant: `merchant-${transactionId}`,
        categoryId: `category-${transactionId}`,
        memo: `memo-${transactionId}`,
        accountingDate: transactionId === "A" ? "2026-07-25" : "2026-07-20",
        localTime: transactionId === "A" ? "20:30" : "09:00",
        cardDisplay: transactionId === "A" ? "target-card" : "source-card",
        cardType: transactionId === "A" ? "local_currency" : "captured",
        aggregateVersion: 1,
        source: "android-notification",
        originChannel: "android",
        creatorMemberId: actor.actingMemberId,
        cardEvidence: `evidence-${transactionId}`,
        captureLineageId: `lineage-${transactionId}`,
      });
    }
    await batch.commit();
    const handlers = createLedgerHouseholdCommandHandlers(database);

    const first = (await execute(
      handlers,
      "ledger.merge-transactions.v1",
      "merge-ab-integration",
      {
        targetTransactionId: "A",
        sourceTransactionId: "B",
        expectedVersions: { A: 1, B: 1 },
      },
    )) as { transactionId: string };
    expect(first.transactionId).toBe("merged:merge-ab-integration");

    const second = (await execute(
      handlers,
      "ledger.merge-transactions.v1",
      "merge-abc-integration",
      {
        targetTransactionId: first.transactionId,
        sourceTransactionId: "C",
        expectedVersions: { [first.transactionId]: 1, C: 1 },
      },
    )) as {
      transactionId: string;
      transaction: Record<string, unknown>;
    };
    const finalMergedId = "merged:merge-abc-integration";
    expect(second).toMatchObject({
      transactionId: finalMergedId,
      transaction: {
        transactionId: finalMergedId,
        amountInWon: 6_000,
        mergeLeafIds: ["A", "B", "C"],
      },
    });
    expect(
      (
        await household
          .collection("ledgerTransactions")
          .doc(first.transactionId)
          .get()
      ).data(),
    ).toMatchObject({
      lifecycleState: "superseded",
      aggregateVersion: 2,
      mergeLeafIds: ["A", "B"],
    });
    const finalLegacy = (
      await database.collection("expenses").doc(finalMergedId).get()
    ).data();
    expect(finalLegacy).toMatchObject({
      amountInWon: 6_000,
      mergeLeafIds: ["A", "B", "C"],
      intermediateMergeHistoryIds: [first.transactionId],
    });
    expect(finalLegacy?.mergedFrom).toEqual([
      {
        merchant: "merchant-A",
        amount: 1_000,
        category: "category-A",
        memo: "memo-A",
      },
      {
        merchant: "merchant-B",
        amount: 2_000,
        category: "category-B",
        memo: "memo-B",
      },
      {
        merchant: "merchant-C",
        amount: 3_000,
        category: "category-C",
        memo: "memo-C",
      },
    ]);

    const restored = (await execute(
      handlers,
      "ledger.unmerge-transaction.v1",
      "unmerge-abc-integration",
      { transactionId: finalMergedId, expectedVersion: 1 },
    )) as { transactionIds: string[] };
    expect(restored.transactionIds).toEqual(["A", "B", "C"]);
    for (const transactionId of restored.transactionIds) {
      expect(
        (
          await household
            .collection("ledgerTransactions")
            .doc(transactionId)
            .get()
        ).data(),
      ).toMatchObject({
        lifecycleState: "active",
        aggregateVersion: 3,
        merchant: `merchant-${transactionId}`,
        accountingDate: "2026-07-25",
        localTime: "20:30",
        cardDisplay: "target-card",
        cardType: "local_currency",
      });
    }
  });

  it("자기 자신을 leaf로 가진 비정상 병합은 MERGE_ANCESTRY_CYCLE로 쓰기 전에 거절한다", async () => {
    const household = database.collection("households").doc(HOUSEHOLD_ID);
    const batch = database.batch();
    for (const transactionId of ["M", "X"] as const) {
      batch.set(household.collection("ledgerTransactions").doc(transactionId), {
        householdId: HOUSEHOLD_ID,
        transactionType: "expense",
        lifecycleState: "active",
        amountInWon: 1_000,
        merchant: transactionId,
        categoryId: "etc",
        memo: "",
        accountingDate: "2026-07-25",
        localTime: "10:00",
        cardDisplay: "card",
        cardType: "captured",
        aggregateVersion: 1,
        source: "manual",
        originChannel: "web",
        creatorMemberId: actor.actingMemberId,
        cardEvidence: "card",
        captureLineageId: `lineage-${transactionId}`,
        ...(transactionId === "M" ? { mergeLeafIds: ["M"] } : {}),
      });
    }
    await batch.commit();
    const handlers = createLedgerHouseholdCommandHandlers(database);

    await expect(
      execute(
        handlers,
        "ledger.merge-transactions.v1",
        "merge-cycle-integration",
        {
          targetTransactionId: "M",
          sourceTransactionId: "X",
          expectedVersions: { M: 1, X: 1 },
        },
      ),
    ).rejects.toMatchObject({ code: "MERGE_ANCESTRY_CYCLE" });
    expect(
      (
        await household.collection("ledgerTransactions").doc("M").get()
      ).data(),
    ).toMatchObject({ lifecycleState: "active", aggregateVersion: 1 });
    expect(
      await household
        .collection("ledgerTransactions")
        .doc("merged:merge-cycle-integration")
        .get(),
    ).toMatchObject({ exists: false });
  });

  it("mergedFrom은 있지만 mergeLeafIds가 없는 legacy 병합 거래는 재병합을 fail-closed로 거절한다", async () => {
    const household = database.collection("households").doc(HOUSEHOLD_ID);
    await database.collection("expenses").doc("legacy-merged").set({
      householdId: HOUSEHOLD_ID,
      transactionType: "expense",
      lifecycleState: "active",
      amountInWon: 3_000,
      amount: 3_000,
      merchant: "legacy-merged",
      categoryId: "etc",
      category: "etc",
      memo: "",
      accountingDate: "2026-07-25",
      date: "2026-07-25",
      localTime: "10:00",
      time: "10:00",
      cardDisplay: "legacy-card",
      cardType: "captured",
      aggregateVersion: 1,
      source: "legacy",
      originChannel: "web",
      creatorMemberId: actor.actingMemberId,
      captureLineageId: "lineage-legacy-merged",
      mergedFrom: [
        { merchant: "leaf-a", amount: 1_000, category: "etc" },
        { merchant: "leaf-b", amount: 2_000, category: "etc" },
      ],
    });
    await household.collection("ledgerTransactions").doc("source").set({
      householdId: HOUSEHOLD_ID,
      transactionType: "expense",
      lifecycleState: "active",
      amountInWon: 2_000,
      merchant: "source",
      categoryId: "etc",
      memo: "",
      accountingDate: "2026-07-25",
      localTime: "11:00",
      cardDisplay: "source-card",
      cardType: "captured",
      aggregateVersion: 1,
      source: "manual",
      originChannel: "web",
      creatorMemberId: actor.actingMemberId,
      captureLineageId: "lineage-source",
    });
    const handlers = createLedgerHouseholdCommandHandlers(database);

    await expect(
      execute(
        handlers,
        "ledger.merge-transactions.v1",
        "legacy-incomplete-merge-command",
        {
          targetTransactionId: "legacy-merged",
          sourceTransactionId: "source",
          expectedVersions: { "legacy-merged": 1, source: 1 },
        },
      ),
    ).rejects.toMatchObject({ code: "RESTORATION_SNAPSHOT_INCOMPLETE" });
    expect(
      (await database.collection("expenses").doc("legacy-merged").get()).data(),
    ).toMatchObject({ lifecycleState: "active", aggregateVersion: 1 });
    expect(
      (await household.collection("ledgerTransactions").doc("source").get()).data(),
    ).toMatchObject({ lifecycleState: "active", aggregateVersion: 1 });
    expect(
      await household
        .collection("ledgerTransactions")
        .doc("merged:legacy-incomplete-merge-command")
        .get(),
    ).toMatchObject({ exists: false });
  });

  it("legacy-only 및 canonical 불완전 split leaf는 병합과 해제 후 구조 metadata를 양쪽 projection에 보존한다", async () => {
    const household = database.collection("households").doc(HOUSEHOLD_ID);
    const splitA = {
      householdId: HOUSEHOLD_ID,
      transactionType: "expense",
      lifecycleState: "active",
      amountInWon: 1_000,
      amount: 1_000,
      merchant: "split-A",
      categoryId: "food",
      category: "food",
      memo: "memo-A",
      accountingDate: "2026-07-25",
      date: "2026-07-25",
      localTime: "12:00",
      time: "12:00",
      cardDisplay: "split-card-A",
      cardLastFour: "split-card-A",
      cardType: "captured",
      aggregateVersion: 1,
      source: "android-notification",
      originChannel: "android",
      creatorMemberId: actor.actingMemberId,
      captureLineageId: "lineage-split-A",
      splitGroupId: "split-group-A",
      splitIndex: 1,
      splitTotal: 3,
      splitOriginalId: "split-original-A",
      derivedFromTransactionId: "split-original-A",
      schemaVersion: 1,
    };
    const splitB = {
      ...splitA,
      amountInWon: 2_000,
      amount: 2_000,
      merchant: "split-B",
      memo: "memo-B",
      cardDisplay: "split-card-B",
      cardLastFour: "split-card-B",
      captureLineageId: "lineage-split-B",
      splitGroupId: "split-group-B",
      splitIndex: 2,
      splitTotal: 4,
      splitOriginalId: "split-original-B",
      derivedFromTransactionId: "split-original-B",
    };
    await database.collection("expenses").doc("split-A").set(splitA);
    await database.collection("expenses").doc("split-B").set(splitB);
    const {
      splitGroupId: _splitGroupId,
      splitIndex: _splitIndex,
      splitTotal: _splitTotal,
      splitOriginalId: _splitOriginalId,
      derivedFromTransactionId: _derivedFromTransactionId,
      ...canonicalB
    } = splitB;
    await household
      .collection("ledgerTransactions")
      .doc("split-B")
      .set({ ...canonicalB, schemaVersion: 2 });
    const handlers = createLedgerHouseholdCommandHandlers(database);

    const merged = (await execute(
      handlers,
      "ledger.merge-transactions.v1",
      "merge-legacy-split-leaves",
      {
        targetTransactionId: "split-A",
        sourceTransactionId: "split-B",
        expectedVersions: { "split-A": 1, "split-B": 1 },
      },
    )) as { transactionId: string };
    expect(
      (
        await household
          .collection("ledgerTransactions")
          .doc(merged.transactionId)
          .get()
      ).data(),
    ).toMatchObject({
      splitGroupId: "split-group-A",
      splitIndex: 1,
      splitTotal: 3,
      splitOriginalId: "split-original-A",
      derivedFromTransactionId: "split-original-A",
    });

    const restored = (await execute(
      handlers,
      "ledger.unmerge-transaction.v1",
      "unmerge-legacy-split-leaves",
      { transactionId: merged.transactionId, expectedVersion: 1 },
    )) as { transactionIds: string[] };
    expect(restored.transactionIds).toEqual(["split-A", "split-B"]);
    for (const [transactionId, metadata] of [
      [
        "split-A",
        {
          splitGroupId: "split-group-A",
          splitIndex: 1,
          splitTotal: 3,
          splitOriginalId: "split-original-A",
          derivedFromTransactionId: "split-original-A",
        },
      ],
      [
        "split-B",
        {
          splitGroupId: "split-group-B",
          splitIndex: 2,
          splitTotal: 4,
          splitOriginalId: "split-original-B",
          derivedFromTransactionId: "split-original-B",
        },
      ],
    ] as const) {
      expect(
        (
          await household
            .collection("ledgerTransactions")
            .doc(transactionId)
            .get()
        ).data(),
      ).toMatchObject({
        lifecycleState: "active",
        aggregateVersion: 3,
        ...metadata,
      });
      expect(
        (await database.collection("expenses").doc(transactionId).get()).data(),
      ).toMatchObject({
        lifecycleState: "active",
        aggregateVersion: 3,
        ...metadata,
      });
    }
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
      source: "recurring",
      cardType: "recurring",
      cardDisplay: "정기지출",
      cardLastFour: "정기지출",
    });
    expect(
      (await database.collection("expenses").doc(first.ledgerTransactionId).get()).data(),
    ).toMatchObject({
      source: "recurring",
      cardType: "recurring",
      cardDisplay: "정기지출",
      cardLastFour: "정기지출",
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
