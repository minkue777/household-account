import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { categoryCatalogDocument } from "../../support/category-catalog-document";

import { createCategoryHouseholdCommandHandlers } from "../../../src/bootstrap/commands/categoryHouseholdCommandHandlers";
import { createLedgerHouseholdCommandHandlers } from "../../../src/bootstrap/commands/ledgerHouseholdCommandHandlers";
import { createAndroidProviderParser, createAndroidRawNotificationSubmissionApplication } from "../../../src/contexts/payment-capture/android-payment-ingestion/public";
import { createCaptureSubmissionApplication } from "../../../src/contexts/payment-capture/android-payment-ingestion/application/captureSubmissionApplication";
import { createCaptureBranchSubmissionApplication } from "../../../src/contexts/payment-capture/android-payment-ingestion/application/captureBranchSubmissionApplication";
import { createCaptureTransactionGatewayApplication } from "../../../src/contexts/payment-capture/android-payment-ingestion/application/captureTransactionGatewayApplication";
import { FirebaseCaptureConfigurationQuery } from "../../../src/adapters/firebase/payment-capture/firebaseCaptureConfigurationQuery";
import { FirebaseCaptureLedgerPersistence } from "../../../src/adapters/firebase/payment-capture/firebaseCaptureLedgerPersistence";
import { FirebaseCaptureSubmissionReceiptStore, Sha256CapturePayloadFingerprint } from "../../../src/adapters/firebase/payment-capture/firebaseCaptureSubmissionReceiptStore";
import { Sha256AndroidRawNotificationHasher } from "../../../src/adapters/crypto/payment-capture/sha256AndroidRawNotificationHasher";
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

  async function tagFixture() {
    const household = database.collection("households").doc(HOUSEHOLD_ID);
    await household.collection("categoryCatalog").doc("current")
      .set(categoryCatalogDocument(HOUSEHOLD_ID, [{ categoryId: "food", name: "식비" }]));
    const handlers = createLedgerHouseholdCommandHandlers(database);
    const run = (command: string, commandId: string, payload: Record<string, unknown>) =>
      execute(handlers, command, commandId, payload);
    const record = async (commandId: string, tags?: string[]) => run(
      "ledger.record-manual-transaction.v1", commandId,
      { transactionType: "expense", merchant: "부산 식당", amountInWon: 12_000,
        categoryId: "food", accountingDate: "2026-09-18", ...(tags === undefined ? {} : { tags }) },
    ) as Promise<{ transactionId: string; aggregateVersion: number; tags: string[] }>;
    const canonical = household.collection("ledgerTransactions");
    const read = async (transactionId: string) => (await canonical.doc(transactionId).get()).data();
    return { run, record, read, canonical };
  }

  it("지출 태그는 저장·재조회되며 구버전 수정 요청은 보존하고 명시한 빈 배열은 제거한다", async () => {
    const { run, record, read, canonical } = await tagFixture();
    const created = await record("tag-create", [" #2026부산여행 ", "2026부산여행", "가족"]);
    expect(created.tags).toEqual(["2026부산여행", "가족"]);
    expect((await read(created.transactionId))?.tags).toEqual(created.tags);
    const legacyEdit = await run("ledger.update-transaction.v1", "tag-legacy-edit", {
      transactionId: created.transactionId, expectedVersion: 1, patch: { memo: "점심" },
    });
    expect(legacyEdit).toMatchObject({ tags: created.tags, aggregateVersion: 2 });
    expect((await read(created.transactionId))?.tags).toEqual(created.tags);
    await run("ledger.update-transaction.v1", "tag-replace", {
      transactionId: created.transactionId, expectedVersion: 2, patch: { tags: ["#2026서울여행"] },
    });
    expect((await read(created.transactionId))?.tags).toEqual(["2026서울여행"]);
    await expect(run("ledger.update-transaction.v1", "tag-invalid-edit", {
      transactionId: created.transactionId, expectedVersion: 3, patch: { tags: "잘못된 값", memo: "저장 금지" },
    })).rejects.toMatchObject({ code: "TAGS_INVALID" });
    expect(await read(created.transactionId)).toMatchObject({ tags: ["2026서울여행"], memo: "점심", aggregateVersion: 3 });
    await run("ledger.update-transaction.v1", "tag-clear", {
      transactionId: created.transactionId, expectedVersion: 3, patch: { tags: [] },
    });
    expect((await read(created.transactionId))?.tags).toEqual([]);
    const legacy = await record("tag-legacy-create");
    const legacyData = (await read(legacy.transactionId))!;
    delete legacyData.tags;
    await canonical.doc(legacy.transactionId).set(legacyData);
    expect(await run("ledger.update-transaction.v1", "tag-pre-feature-edit", {
      transactionId: legacy.transactionId, expectedVersion: 1, patch: { memo: "태그 도입 전 거래" },
    })).toMatchObject({ tags: [], memo: "태그 도입 전 거래" });
    const overLimitTags = [...Array.from({ length: 11 }, (_, index) => `기존 행사${index}`), "가".repeat(31)];
    await canonical.doc(legacy.transactionId).set({ tags: overLimitTags }, { merge: true });
    expect(await run("ledger.update-transaction.v1", "tag-preserve-stored-limits", {
      transactionId: legacy.transactionId, expectedVersion: 2, patch: { memo: "기존 태그 보존" },
    })).toMatchObject({ tags: overLimitTags, aggregateVersion: 3 });
    expect((await read(legacy.transactionId))?.tags).toEqual(overLimitTags);
  });

  it("항목 분할은 생략한 태그를 상속하고 개별 태그와 원본 복원 태그를 보존한다", async () => {
    const { run, record, read } = await tagFixture();
    const original = await record("tag-item-source", ["2026부산여행"]);
    const split = await run("ledger.split-transaction.v1", "tag-item-split", {
      transactionId: original.transactionId, expectedVersion: 1,
      operation: { kind: "items",
        baseDraft: { merchant: "부산 식당", amountInWon: 12_000, categoryId: "food", memo: "수정 메모" },
        items: [
          { merchant: "식사", amountInWon: 6_000, categoryId: "food", memo: "" },
          { merchant: "간식", amountInWon: 3_000, categoryId: "food", memo: "", tags: ["#간식"] },
          { merchant: "별도 지출", amountInWon: 3_000, categoryId: "food", memo: "", tags: [] },
        ],
      },
    }) as { transactionIds: string[] };
    expect((await read(split.transactionIds[0]))?.tags).toEqual(["2026부산여행"]);
    expect((await read(split.transactionIds[1]))?.tags).toEqual(["간식"]);
    expect((await read(split.transactionIds[2]))?.tags).toEqual([]);
    await run("ledger.restore-item-split.v1", "tag-item-restore", {
      sourceId: original.transactionId,
      expectedVersions: Object.fromEntries(split.transactionIds.map((id) => [id, 1])),
    });
    expect(await read(original.transactionId)).toMatchObject({ tags: ["2026부산여행"], lifecycleState: "active" });
  });

  it("신규 및 기존 월 분할·개월 재구성·분할 해제는 태그를 보존한다", async () => {
    const { run, record, read, canonical } = await tagFixture();
    const original = await record("tag-monthly-source", ["2026부산여행"]);
    const split = await run("ledger.split-existing-transaction-monthly.v1", "tag-monthly-split", {
      transactionId: original.transactionId, expectedVersion: 1, months: 2,
    }) as { transactionIds: string[]; splitGroupId: string };
    for (const id of split.transactionIds) expect((await read(id))?.tags).toEqual(["2026부산여행"]);
    await run("ledger.reconfigure-monthly-split.v1", "tag-monthly-reconfigure", {
      splitGroupId: split.splitGroupId, months: 3,
      expectedVersions: Object.fromEntries(split.transactionIds.map((id) => [id, 1])),
    });
    const parts = (await canonical.where("splitGroupId", "==", split.splitGroupId).get()).docs;
    expect(parts).toHaveLength(3);
    for (const part of parts) expect(part.data().tags).toEqual(["2026부산여행"]);
    await run("ledger.cancel-monthly-split.v1", "tag-monthly-collapse", {
      splitGroupId: split.splitGroupId,
      expectedVersions: Object.fromEntries(parts.map((part) => [part.id, part.data().aggregateVersion])),
    });
    expect(await read(original.transactionId)).toMatchObject({ tags: ["2026부산여행"], lifecycleState: "active" });
    const manual = await run("ledger.record-manual-monthly-split.v1", "tag-monthly-new", {
      transactionType: "expense", merchant: "숙소", amountInWon: 120_000, categoryId: "food",
      accountingDate: "2026-09-18", months: 2, tags: ["#2026부산여행"],
    }) as { transactionIds: string[] };
    for (const id of manual.transactionIds) expect((await read(id))?.tags).toEqual(["2026부산여행"]);
  });

  it("합친 거래는 중복 없는 태그를 반환하고 합치기 해제는 각 원본의 태그를 복원한다", async () => {
    const { run, record, read } = await tagFixture();
    const first = await record("tag-merge-first", ["2026부산여행", "가족"]);
    const second = await record("tag-merge-second", ["2026부산여행", "친구"]);
    const merged = await run("ledger.merge-transactions.v1", "tag-merge", {
      targetTransactionId: first.transactionId, sourceTransactionId: second.transactionId,
      expectedVersions: { [first.transactionId]: 1, [second.transactionId]: 1 },
    }) as { transactionId: string; transaction: { tags: string[] } };
    expect(merged.transaction.tags).toEqual(["2026부산여행", "가족", "친구"]);
    expect((await read(merged.transactionId))?.tags).toEqual(merged.transaction.tags);
    await run("ledger.unmerge-transaction.v1", "tag-unmerge", { transactionId: merged.transactionId, expectedVersion: 1 });
    expect(await read(first.transactionId)).toMatchObject({ tags: first.tags, lifecycleState: "active" });
    expect(await read(second.transactionId)).toMatchObject({ tags: second.tags, lifecycleState: "active" });
  });

  it("태그 합계가 한도를 넘는 합치기는 태그를 자르지 않고 원본 전체를 보존한다", async () => {
    const { run, record, read } = await tagFixture();
    const first = await record("tag-limit-first", Array.from({ length: 10 }, (_, index) => `행사${index}`));
    const second = await record("tag-limit-second", ["추가 행사"]);
    await expect(run("ledger.merge-transactions.v1", "tag-limit-merge", {
      targetTransactionId: first.transactionId, sourceTransactionId: second.transactionId,
      expectedVersions: { [first.transactionId]: 1, [second.transactionId]: 1 },
    })).rejects.toMatchObject({ code: "TOO_MANY_TAGS" });
    expect(await read(first.transactionId)).toMatchObject({ tags: first.tags, lifecycleState: "active", aggregateVersion: 1 });
    expect(await read(second.transactionId)).toMatchObject({ tags: second.tags, lifecycleState: "active", aggregateVersion: 1 });
  });

  it.each([
    { transformation: "edit", gross: 10_000, cashback: 500 },
    { transformation: "monthly-split", gross: 10_000, cashback: 500 },
    { transformation: "monthly-split", gross: 10_001, cashback: 0 },
  ])("[PARSE-TOSS-001][CAN-003][T-CAN-006][T-CAN-LINEAGE-001] $gross원 승인·$cashback원 캐시백을 $transformation한 뒤에도 원본·모든 파생을 취소한다", async ({ transformation, gross, cashback }) => {
    const net = gross - cashback;
    const household = database.collection("households").doc(HOUSEHOLD_ID);
    await household.collection("registeredCards").doc("toss").set({ ownerMemberId: actor.actingMemberId, companyLabel: "토스", lifecycleState: "active" });
    await household.collection("categoryCatalog").doc("current").set(categoryCatalogDocument(HOUSEHOLD_ID, [{ categoryId: "etc" }], { defaultCategoryId: "etc" }));
    const raw = createAndroidRawNotificationSubmissionApplication({
      parser: createAndroidProviderParser(),
      payloads: new Sha256AndroidRawNotificationHasher(),
      clock: { now: () => REQUESTED_AT },
      submissions: createCaptureSubmissionApplication({
        tenantAuthorization: {
          resolveActorContext: () => { throw new Error("Actor already resolved"); },
          authorizeHouseholdAction: () => ({ kind: "allowed" }),
        },
        branches: createCaptureBranchSubmissionApplication({
          receipts: new FirebaseCaptureSubmissionReceiptStore(database),
          payloads: new Sha256CapturePayloadFingerprint(),
          transactions: createCaptureTransactionGatewayApplication({ configuration: new FirebaseCaptureConfigurationQuery(database), ledger: new FirebaseCaptureLedgerPersistence(database) }),
          balances: { recordBalanceObservation: async () => { throw new Error("Toss has no balance branch"); } },
        }),
      }),
    });
    const submit = (cancel: boolean) => raw.submit({
      actor: { principalId: actor.principalUid, householdId: HOUSEHOLD_ID, actingMemberId: actor.actingMemberId, capabilities: ["paymentCapture:submit"] },
      input: {
        contractVersion: "android-raw-notification.v1",
        observationId: `observation.toss.${cancel ? "cancel" : "approval"}`,
        packageName: "viva.republica.toss",
        notification: { postedAt: cancel ? "2026-07-22T10:00:00+09:00" : "2026-07-21T10:00:00+09:00", title: "토스", textLines: ["토스뱅크 체크카드 | 원래 가맹점", `${gross}원 결제${cancel ? " 취소" : ""}`, `${cashback}원 캐시백`] },
      },
    });
    const approved = await submit(false);
    if (approved.kind !== "success" || approved.value.transactionResult?.kind !== "created") throw new Error(`Approval required: ${JSON.stringify(approved)}`);
    const transactionId = approved.value.transactionResult.transactionId;
    const canonical = household.collection("ledgerTransactions");
    expect(approved.value.transactionResult.quickEditSnapshot?.amountInWon).toBe(net);
    expect((await canonical.doc(transactionId).get()).data()?.amountInWon).toBe(net);
    expect((await database.collection("expenses").doc(transactionId).get()).exists).toBe(false);
    const evidence = (await household.collection("captureRecords").get()).docs[0];
    expect(evidence.data()).toMatchObject({ amountInWon: net, approvalAmountInWon: gross });
    const handlers = createLedgerHouseholdCommandHandlers(database);
    let derivedIds: string[] = [];
    if (transformation === "edit") {
      const edited = await execute(handlers, "ledger.update-transaction.v1", "edit-toss", { transactionId, expectedVersion: 1, patch: { amountInWon: 7_500, merchant: "바꾼 가맹점" } });
      expect(edited).toMatchObject({ amountInWon: 7_500, merchant: "바꾼 가맹점", aggregateVersion: 2 });
    } else {
      const split = await execute(handlers, "ledger.split-existing-transaction-monthly.v1", "split-toss", { transactionId, expectedVersion: 1, months: 2 }) as { transactionIds: string[] };
      derivedIds = split.transactionIds;
      expect(derivedIds).toHaveLength(2);
      for (const id of derivedIds) expect((await canonical.doc(id).get()).data()?.amountInWon).toBe(Math.floor(net / 2));
      expect((await canonical.doc(derivedIds[1]).get()).data()?.accountingDate).toBe("2026-08-21");
    }
    expect((await evidence.ref.get()).data()).toEqual(evidence.data());
    const cancelled = await submit(true);
    expect(cancelled).toMatchObject({ kind: "success", value: { transactionResult: { kind: "cancelled", transactionIds: expect.arrayContaining([transactionId, ...derivedIds]) } } });
    for (const id of [transactionId, ...derivedIds]) {
      expect((await canonical.doc(id).get()).exists).toBe(false);
      expect((await database.collection("expenses").doc(id).get()).exists).toBe(false);
    }
    expect((await evidence.ref.get()).data()).not.toHaveProperty("approvalAmountInWon");
    const outboxCount = (await database.collection("outboxEvents").get()).size;
    expect(await submit(true)).toEqual(cancelled);
    expect((await database.collection("outboxEvents").get()).size).toBe(outboxCount);
  });

  it("수동 거래의 카드 표시를 canonical에만 수동으로 기록한다", async () => {
    await database.collection("households").doc(HOUSEHOLD_ID).collection("categoryCatalog").doc("current")
      .set(categoryCatalogDocument(HOUSEHOLD_ID, [{ categoryId: "food", name: "식비" }]));
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
    expect(legacy.exists).toBe(false);
  });

  it("지역화폐 거래 수정은 응답과 canonical 문서에 지역화폐 유형을 보존한다", async () => {
    const transactionId = "local-currency-update";
    const source = {
      householdId: HOUSEHOLD_ID,
      transactionType: "expense",
      lifecycleState: "active",
      amountInWon: 12_000,
      accountingDate: "2026-07-22",
      localTime: "12:34",
      merchant: "지역화폐 가맹점",
      categoryId: "etc",
      memo: "수정 전",
      cardType: "captured",
      cardDisplay: "경기지역화폐",
      creatorMemberId: actor.actingMemberId,
      source: "android-notification",
      originChannel: "android",
      localCurrencyType: "gyeonggi",
      aggregateVersion: 1,
    };
    await database
      .collection("households")
      .doc(HOUSEHOLD_ID)
      .collection("ledgerTransactions")
      .doc(transactionId)
      .set(source);

    const result = (await execute(
      createLedgerHouseholdCommandHandlers(database),
      "ledger.update-transaction.v1",
      "local-currency-update-command",
      {
        transactionId,
        expectedVersion: 1,
        patch: { memo: "수정 후" },
      },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      transactionId,
      memo: "수정 후",
      localCurrencyType: "gyeonggi",
      aggregateVersion: 2,
    });
    expect(
      (
        await database
          .collection("households")
          .doc(HOUSEHOLD_ID)
          .collection("ledgerTransactions")
          .doc(transactionId)
          .get()
      ).data(),
    ).toMatchObject({ localCurrencyType: "gyeonggi", memo: "수정 후" });
    expect(
      (await database.collection("expenses").doc(transactionId).get()).exists,
    ).toBe(false);
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
      localCurrencyType: "gyeonggi",
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
    expect(parts.map((part) => part.data()?.localCurrencyType)).toEqual([
      "gyeonggi",
      "gyeonggi",
    ]);

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
      localCurrencyType: "gyeonggi",
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
    await database.collection("households").doc(HOUSEHOLD_ID).collection("categoryCatalog").doc("current")
      .set(categoryCatalogDocument(HOUSEHOLD_ID, [{ categoryId: "food", name: "식비" }]));
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
      localCurrencyType: "gyeonggi",
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
      localCurrencyType: "gyeonggi",
    });
    expect((await canonical.doc(result.transactionIds[1]).get()).data()).toMatchObject({
      merchant: "두 번째 항목",
      amountInWon: 8_000,
      derivedFromTransactionId: "item-split-source",
      localCurrencyType: "gyeonggi",
    });
    expect((await canonical.doc("unrelated-item-259").get()).data()).toMatchObject({
      aggregateVersion: 1,
      merchant: "무관 항목 259",
    });
  });

  it("카테고리 6개 command가 단일 catalog 원본을 원자적으로 갱신한다", async () => {
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
      expectedCatalogVersion: 2,
      categoryId: first.categoryId,
    });
    await execute(handlers, "category.update.v1", "category-update-1", {
      expectedVersion: 1,
      categoryId: second.categoryId,
      changes: { label: "여가", color: "#ABCDEF" },
    });
    await execute(handlers, "category.set-budget.v1", "category-budget-1", {
      expectedVersion: 2,
      categoryId: second.categoryId,
      budget: 55_000,
    });
    await execute(handlers, "category.reorder.v1", "category-reorder-1", {
      expectedCatalogVersion: 5,
      categories: [
        { categoryId: second.categoryId, order: 0 },
        { categoryId: first.categoryId, order: 1 },
      ],
    });
    await execute(handlers, "category.archive.v1", "category-archive-1", {
      expectedVersion: 4,
      categoryId: second.categoryId,
    });

    const household = database.collection("households").doc(HOUSEHOLD_ID);
    const catalog = (await household.collection("categoryCatalog").doc("current").get()).data()!;
    expect(catalog.defaultCategoryId).toBe(first.categoryId);
    expect(catalog.categories.find((category: { categoryId: string }) => category.categoryId === second.categoryId)).toMatchObject({
      name: "여가",
      color: "#ABCDEF",
      budgetInWon: 55_000,
      state: "archived",
      sortOrder: 0,
    });
    const legacyProjection = (
      await database
        .collection("categories")
        .where("householdId", "==", HOUSEHOLD_ID)
        .get()
    );
    expect(legacyProjection.empty).toBe(true);
    expect((await household.collection("categories").get()).empty).toBe(true);
    expect((await household.collection("categorySettings").get()).empty).toBe(true);
    expect((await household.collection("categoryArchiveProcesses").get()).size).toBe(1);
    expect(
      (
        await database
          .collection("commandReceipts")
          .doc("household-finance-category-catalog")
          .collection("receipts")
          .get()
      ).size,
    ).toBe(8);
  });

  it("이관한 물리 ID 별칭은 단일 catalog의 stable category를 수정하며 legacy 원본은 변경하지 않는다", async () => {
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
    await database.collection("households").doc(HOUSEHOLD_ID).collection("categoryCatalog").doc("current").set(
      categoryCatalogDocument(HOUSEHOLD_ID, [{ categoryId: "legacy-category-key", name: "기존 이름", color: "#111111" }], {
        defaultCategoryId: "legacy-category-key", categoryAliases: { "legacy-category-document": "legacy-category-key" },
      }),
    );
    const handlers = createCategoryHouseholdCommandHandlers(database);
    await execute(handlers, "category.update.v1", "legacy-category-update", {
      expectedVersion: 1,
      categoryId: "legacy-category-document",
      changes: { label: "바뀐 이름" },
    });
    expect(
      (await database.collection("categories").doc("legacy-category-document").get()).data(),
    ).toMatchObject({ key: "legacy-category-key", label: "기존 이름" });
    expect(
      await database.collection("categories").doc("legacy-category-key").get(),
    ).toMatchObject({ exists: false });
    expect(
      (
        await database
          .collection("households")
          .doc(HOUSEHOLD_ID)
          .collection("categoryCatalog")
          .doc("current")
          .get()
      ).data(),
    ).toMatchObject({ categories: [{ categoryId: "legacy-category-key", name: "바뀐 이름", version: 2 }],
      categoryAliases: { "legacy-category-document": "legacy-category-key" } });
  });

  it("정기지출 create/update/delete가 creator, version, tombstone, Outbox를 보존한다", async () => {
    const categoryId = "category-recurring";
    await database.collection("households").doc(HOUSEHOLD_ID).collection("categoryCatalog").doc("current")
      .set(categoryCatalogDocument(HOUSEHOLD_ID, [{ categoryId, name: "정기", color: "#112233" }]));
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
      expectedVersion: 1,
      planId: created.planId,
      changes: { amount: 55_000, dayOfMonth: 27, isActive: true },
    });
    await execute(handlers, "recurring.delete-plan.v1", "recurring-delete-1", {
      expectedVersion: 2,
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
        localCurrencyType: "gyeonggi",
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
        localCurrencyType: "gyeonggi",
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
      localCurrencyType: "gyeonggi",
    });
    const mergedDocument = (
      await household.collection("ledgerTransactions").doc(mergedId).get()
    ).data();
    expect(mergedDocument).toMatchObject({
      transactionType: "expense",
      cardType: "local_currency",
      mergeLeafIds: ["expense-a", "expense-b"],
      localCurrencyType: "gyeonggi",
    });
    expect(mergedDocument?.mergedFrom).toEqual([
      expect.objectContaining({ amount: 40_000, category: "etc" }),
      expect.objectContaining({ amount: 60_000, category: "etc" }),
    ]);
    for (const transactionId of ["expense-a", "expense-b"]) {
      expect((await household.collection("ledgerTransactions").doc(transactionId).get()).data())
        .toMatchObject({ lifecycleState: "superseded", aggregateVersion: 2 });
    }
    expect((await database.collection("expenses").get()).empty).toBe(true);

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
      localCurrencyType: "gyeonggi",
    });
    expect((await household.collection("ledgerTransactions").doc("expense-b").get()).data()).toMatchObject({
      lifecycleState: "active",
      aggregateVersion: 3,
      transactionType: "expense",
      accountingDate: "2026-07-21",
      localTime: "12:00",
      cardDisplay: "target-card",
      cardType: "local_currency",
      localCurrencyType: "gyeonggi",
    });
    expect((await household.collection("ledgerTransactions").doc(mergedId).get()).data()).toMatchObject({
      lifecycleState: "deleted",
      aggregateVersion: 2,
    });
    expect((await database.collection("expenses").get()).empty).toBe(true);
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
    const finalDocument = (
      await household.collection("ledgerTransactions").doc(finalMergedId).get()
    ).data();
    expect(finalDocument).toMatchObject({
      amountInWon: 6_000,
      mergeLeafIds: ["A", "B", "C"],
      intermediateMergeHistoryIds: [first.transactionId],
    });
    expect(finalDocument?.mergedFrom).toEqual([
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

  it("이관한 mergedFrom에 mergeLeafIds가 없으면 재병합을 무변경으로 거절한다", async () => {
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
    const preservedLegacy = (await database.collection("expenses").doc("legacy-merged").get()).data()!;
    await household.collection("ledgerTransactions").doc("legacy-merged").set({ ...preservedLegacy, schemaVersion: 2 });
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
    ).toEqual(preservedLegacy);
    expect((await household.collection("ledgerTransactions").doc("legacy-merged").get()).data())
      .toMatchObject({ lifecycleState: "active", aggregateVersion: 1 });
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

  it("이관한 split leaf는 병합과 해제 후 canonical 구조 metadata를 보존하고 stale legacy 원본은 변경하지 않는다", async () => {
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
    await household.collection("ledgerTransactions").doc("split-A").set({ ...splitA, schemaVersion: 2 });
    await household
      .collection("ledgerTransactions")
      .doc("split-B")
      .set({ ...splitB, schemaVersion: 2 });
    // 보존용 원본이 뒤처져 있어도 현재 구조를 덮어쓰거나 재활성화하지 않습니다.
    await database.collection("expenses").doc("split-B").update({ splitTotal: 99 });
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
        aggregateVersion: 1,
        ...metadata,
        ...(transactionId === "split-B" ? { splitTotal: 99 } : {}),
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
      (await database.collection("expenses").doc(first.ledgerTransactionId).get()).exists,
    ).toBe(false);
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
      targets: [],
    });
    expect(await pages.nextPage("recurring:complete")).toBeUndefined();
  });
});

function hashForTest(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}
