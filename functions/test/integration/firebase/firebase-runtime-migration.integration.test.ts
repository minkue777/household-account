import { createHash } from "node:crypto";

import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { FirebaseRuntimeMigrationPlanBuilder } from "../../../src/adapters/firebase/migration/firebaseRuntimeMigrationPlanBuilder";
import { FirebaseRuntimeMigrationPersistence } from "../../../src/adapters/firebase/migration/firebaseRuntimeMigrationPersistence";
import {
  createRuntimeMigrationApplication,
  RUNTIME_MIGRATION_KIND,
  RUNTIME_MIGRATION_SCHEMA_SCOPE,
  type RuntimeMigrationMappingManifest,
} from "../../../src/operations/migration/public";

const PROJECT_ID = "demo-household-account-runtime-migration";
const HOUSEHOLD_ID = "house-migration-a";
const OTHER_HOUSEHOLD_ID = "house-migration-b";
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

function scope(migrationId = "runtime-v1") {
  return {
    projectId: PROJECT_ID,
    householdId: HOUSEHOLD_ID,
    migrationId,
    migrationKind: RUNTIME_MIGRATION_KIND,
    schemaScope: RUNTIME_MIGRATION_SCHEMA_SCOPE,
    operatorId: "operations-migration-admin",
  } as const;
}

function subject() {
  return createRuntimeMigrationApplication({
    builder: new FirebaseRuntimeMigrationPlanBuilder(database, PROJECT_ID),
    persistence: new FirebaseRuntimeMigrationPersistence(database, PROJECT_ID),
  });
}

function mappings(
  overrides: Partial<RuntimeMigrationMappingManifest> = {},
): RuntimeMigrationMappingManifest {
  return {
    version: 1,
    householdIdHash: createHash("sha256")
      .update(HOUSEHOLD_ID, "utf8")
      .digest("hex"),
    memberReferences: { "민규": "member-a" },
    ledgerNotificationRequesters: { "expense-1": "member-a" },
    recurringCreators: { "recurring-1": "member-b" },
    registeredCardOwners: { "card-1": "member-a" },
    merchantRulePriorities: { "rule-contains": 10 },
    assetOwners: { "민규": "profile-a" },
    positionMarkets: { "holding-1": "KRX" },
    ...overrides,
  };
}

async function seedFullScope() {
  const household = database.collection("households").doc(HOUSEHOLD_ID);
  await Promise.all([
    household.set({
      lifecycleState: "active",
      homeSummaryConfig: {
        leftCard: "localCurrencyBalance",
        rightCard: "monthlySpent",
      },
      homeSummaryConfigVersion: 3,
      selectedLocalCurrencyType: "gyeonggi",
      defaultCategoryKey: "food",
      schemaVersion: 1,
    }),
    household.collection("members").doc("member-a").set({
      memberId: "member-a",
      displayName: "민규",
      lifecycleState: "active",
    }),
    household.collection("members").doc("member-b").set({
      memberId: "member-b",
      displayName: "진선",
      lifecycleState: "active",
    }),
    household.collection("assetOwnerProfiles").doc("profile-a").set({
      profileId: "profile-a",
      displayName: "민규",
      profileType: "member",
      linkedMemberId: "member-a",
      lifecycleState: "active",
    }),
    database.collection("expenses").doc("expense-1").set({
      householdId: HOUSEHOLD_ID,
      merchant: "가맹점",
      amount: 25_000,
      category: "food",
      date: "2026-07-20",
      time: "12:30",
      createdBy: "민규",
      notifyPartnerAt: "2026-07-20T03:31:00.000Z",
      notifyPartnerBy: "legacy-requester",
      lifecycleState: "superseded",
      source: "android-notification",
      originChannel: "android",
      cardDisplay: "삼성카드(1234)",
      cardEvidence: "삼성카드(1234)",
      cardLastFour: "1234",
      sourceFingerprint: "capture-fingerprint-1",
      captureLineageId: "capture-lineage-1",
      localCurrencyType: "gyeonggi",
      splitGroupId: "split-group-1",
      splitIndex: 1,
      splitTotal: 2,
      splitOriginalId: "expense-original-1",
      mergedFrom: [{ transactionId: "expense-leaf-1", amountInWon: 10_000 }],
      mergeLeafIds: ["expense-leaf-1", "expense-leaf-2"],
      intermediateMergeHistoryIds: ["expense-merge-0"],
      mergeLeafSnapshots: [
        { transactionId: "expense-leaf-1", captureLineageId: "capture-leaf-1" },
      ],
      derivedFromTransactionId: "expense-original-1",
      schemaVersion: 1,
      createdAt: "2026-07-20T03:30:00.000Z",
      updatedAt: "2026-07-20T03:30:00.000Z",
    }),
    database.collection("assets").doc("asset-1").set({
      householdId: HOUSEHOLD_ID,
      name: "적금",
      type: "savings",
      subType: "적금",
      owner: "민규",
      currentBalance: 1_000_000,
      recurringContributionAmount: 100_000,
      recurringContributionDay: 18,
      lastAutoContributionMonth: "2026-06",
      isActive: true,
      schemaVersion: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    }),
    database.collection("categories").doc("food").set({
      householdId: HOUSEHOLD_ID,
      key: "food",
      label: "식비",
      color: "#ff0000",
      budget: 500_000,
      isDefault: true,
      isActive: true,
      schemaVersion: 1,
    }),
    database.collection("recurring_expenses").doc("recurring-1").set({
      householdId: HOUSEHOLD_ID,
      merchant: "보험",
      amount: 80_000,
      category: "food",
      dayOfMonth: 10,
      isActive: true,
      schemaVersion: 1,
      createdAt: "2026-01-10T00:00:00.000Z",
      updatedAt: "2026-01-10T00:00:00.000Z",
    }),
    database.collection("stock_holdings").doc("holding-1").set({
      householdId: HOUSEHOLD_ID,
      assetId: "asset-1",
      stockCode: "005930",
      stockName: "삼성전자",
      quantity: 10,
      avgPrice: 70_000,
      currentPrice: 80_000,
      schemaVersion: 1,
    }),
    database.collection("registered_cards").doc("card-1").set({
      householdId: HOUSEHOLD_ID,
      owner: "legacy-owner-name",
      cardLabel: "Samsung Card",
      cardLastFour: "1234",
      orderIndex: 1,
      schemaVersion: 1,
    }),
    database.collection("merchant_rules").doc("rule-1").set({
      householdId: HOUSEHOLD_ID,
      merchantKeyword: "Coffee, Cafe",
      exactMatch: true,
      category: "food",
      isActive: true,
      schemaVersion: 1,
    }),
    database.collection("merchant_rules").doc("rule-contains").set({
      householdId: HOUSEHOLD_ID,
      merchantKeyword: "Market",
      exactMatch: false,
      category: "food",
      isActive: true,
      schemaVersion: 1,
    }),
    database.collection("balances").doc("balance-gyeonggi").set({
      householdId: HOUSEHOLD_ID,
      type: "localCurrency",
      localCurrencyType: "gyeonggi",
      balance: 123_456,
      observedAt: "2026-07-20T14:00:00.000Z",
      schemaVersion: 1,
    }),
    database.collection("expenses").doc("expense-out-of-scope").set({
      householdId: OTHER_HOUSEHOLD_ID,
      merchant: "다른 가구",
      amount: 999_999,
      createdBy: "someone",
      schemaVersion: 1,
    }),
  ]);
}

describeWithFirestoreEmulator("Firebase runtime migration operations boundary", () => {
  beforeAll(() => {
    app = initializeApp({ projectId: PROJECT_ID }, `runtime-migration-${Date.now()}`);
    database = getFirestore(app);
  });

  beforeEach(clearEmulator);

  afterAll(async () => {
    if (app !== undefined) await deleteApp(app);
  });

  it("dry-run은 plan만 영속화하고 명시 승인 apply는 page checkpoint에서 재개·멱등 완료한다", async () => {
    await seedFullScope();
    const migration = subject();
    const dryRun = await migration.dryRun({
      scope: scope(),
      mappings: mappings(),
      plannedAt: "2026-07-21T00:00:00.000Z",
    });

    expect(dryRun).toMatchObject({
      kind: "dry-run",
      candidateCount: expect.any(Number),
      unresolved: [],
      checkpoint: `${dryRun.planHash}:0`,
    });
    expect(dryRun.candidateCount).toBeGreaterThanOrEqual(17);
    const household = database.collection("households").doc(HOUSEHOLD_ID);
    expect((await household.collection("ledgerTransactions").get()).size).toBe(0);
    expect((await database.collection("operationsMigrationPlans").get()).size).toBe(1);
    const repeatedDryRun = await migration.dryRun({
      scope: scope(),
      mappings: mappings(),
      plannedAt: "2026-07-21T00:00:00.000Z",
    });
    expect(repeatedDryRun.planHash).toBe(dryRun.planHash);
    expect((await database.collection("operationsMigrationPlans").get()).size).toBe(1);

    expect(
      await migration.apply({
        scope: scope(),
        expectedPlanHash: dryRun.planHash,
        confirmation: "MISSING",
        pageSize: 2,
        maxPages: 1,
        appliedAt: "2026-07-21T00:01:00.000Z",
      }),
    ).toEqual({ kind: "blocked", code: "EXPLICIT_CONFIRMATION_REQUIRED" });
    expect((await household.collection("ledgerTransactions").get()).size).toBe(0);

    const first = await migration.apply({
      scope: scope(),
      expectedPlanHash: dryRun.planHash,
      confirmation: "APPLY",
      checkpoint: dryRun.checkpoint,
      pageSize: 2,
      maxPages: 1,
      appliedAt: "2026-07-21T00:02:00.000Z",
    });
    expect(first).toMatchObject({
      kind: "checkpoint",
      planHash: dryRun.planHash,
      appliedPages: 1,
      remainingCandidates: expect.any(Number),
    });
    if (first.kind !== "checkpoint") throw new Error("checkpoint required");
    const plannedCandidates = await database
      .collection("operationsMigrationPlans")
      .doc(dryRun.planHash)
      .collection("candidates")
      .orderBy("index", "asc")
      .limit(3)
      .get();
    expect(plannedCandidates.size).toBe(3);
    expect(
      (
        await database
          .doc(String(plannedCandidates.docs[0].data().targetPath))
          .get()
      ).exists,
    ).toBe(true);
    expect(
      (
        await database
          .doc(String(plannedCandidates.docs[1].data().targetPath))
          .get()
      ).exists,
    ).toBe(true);
    expect(
      (
        await database
          .doc(String(plannedCandidates.docs[2].data().targetPath))
          .get()
      ).exists,
    ).toBe(false);

    const completed = await migration.apply({
      scope: scope(),
      expectedPlanHash: dryRun.planHash,
      confirmation: "APPLY",
      checkpoint: first.checkpoint,
      pageSize: 2,
      maxPages: 100,
      appliedAt: "2026-07-21T00:03:00.000Z",
    });
    expect(completed).toMatchObject({
      kind: "applied",
      planHash: dryRun.planHash,
      reconciliation: { status: "MATCH" },
    });
    expect((await household.collection("ledgerTransactions").doc("expense-1").get()).data()).toMatchObject({
      amountInWon: 25_000,
      creatorMemberId: "member-a",
      lifecycleState: "superseded",
      notificationRequest: {
        requesterMemberId: "member-a",
        requestedAt: "2026-07-20T03:31:00.000Z",
      },
      captureLineageId: "capture-lineage-1",
      sourceFingerprint: "capture-fingerprint-1",
      cardEvidence: "삼성카드(1234)",
      cardLastFour: "1234",
      localCurrencyType: "gyeonggi",
      splitGroup: {
        groupId: "split-group-1",
        index: 1,
        total: 2,
        originalId: "expense-original-1",
      },
      mergedFrom: [{ transactionId: "expense-leaf-1", amountInWon: 10_000 }],
      mergeLeafIds: ["expense-leaf-1", "expense-leaf-2"],
      intermediateMergeHistoryIds: ["expense-merge-0"],
      derivedFromTransactionId: "expense-original-1",
    });
    expect((await household.collection("assets").doc("asset-1").get()).data()).toMatchObject({
      currentBalance: 1_000_000,
      ownerRef: { kind: "profile", profileId: "profile-a" },
    });
    expect((await household.collection("assetAutomationPlans").doc("asset-1_savings-contribution").get()).data()).toMatchObject({
      lastAppliedMonth: "2026-06",
      nextDueDate: "2026-07-18",
    });
    expect((await household.collection("assetAutomationPlanRevisions").get()).size).toBe(1);
    expect((await household.collection("categorySettings").doc("default").get()).data()).toMatchObject({
      defaultCategoryId: "food",
    });
    expect((await household.collection("recurringPlans").doc("recurring-1").get()).data()?.creatorMemberId).toBe("member-b");
    expect((await household.collection("recurringCreatorMigrationReceipts").get()).size).toBe(1);
    expect((await household.collection("assets").doc("asset-1").collection("positions").doc("holding-1").get()).data()).toMatchObject({
      market: "KRX",
      instrumentCode: "005930",
    });
    expect((await household.collection("registeredCards").doc("card-1").get()).data()).toMatchObject({
      ownerMemberId: "member-a",
      cardCompanyCode: "Samsung Card",
      lastFour: "1234",
    });
    expect((await household.collection("registeredCardClaims").get()).size).toBe(1);
    expect((await household.collection("merchantRules").doc("rule-1").get()).data()).toMatchObject({
      matchType: "exact",
      normalizedKeywords: ["coffee", "cafe"],
      mapping: { categoryId: "food" },
    });
    expect((await household.collection("merchantRules").doc("rule-contains").get()).data()).toMatchObject({
      matchType: "contains",
      priority: 10,
    });
    expect((await household.collection("merchantRuleClaims").get()).size).toBe(3);
    expect((await household.collection("localCurrencyBalances").doc("gyeonggi").get()).data()).toMatchObject({
      localCurrencyType: "gyeonggi",
      balanceInWon: 123_456,
    });
    expect((await household.collection("homePreferences").doc("home").get()).data()).toMatchObject({
      left: "LOCAL_CURRENCY_BALANCE",
      right: "MONTHLY_EXPENSE",
      selectedLocalCurrencyType: "gyeonggi",
      aggregateVersion: 3,
    });
    expect((await database.collection("expenses").doc("expense-out-of-scope").get()).data()).toMatchObject({
      householdId: OTHER_HOUSEHOLD_ID,
      amount: 999_999,
    });
    expect((await database.collection("operationsMigrationPageReceipts").get()).size).toBeGreaterThan(1);

    const replay = await migration.apply({
      scope: scope(),
      expectedPlanHash: dryRun.planHash,
      confirmation: "APPLY",
      checkpoint: completed.kind === "applied" ? completed.checkpoint : undefined,
      pageSize: 50,
      maxPages: 100,
      appliedAt: "2026-07-21T00:04:00.000Z",
    });
    expect(replay).toMatchObject({ kind: "applied", reconciliation: { status: "MATCH" } });
  });

  it("identity mapping이 빠진 plan은 typed unresolved report를 남기고 업무 write를 0건 유지한다", async () => {
    const household = database.collection("households").doc(HOUSEHOLD_ID);
    await Promise.all([
      household.set({ lifecycleState: "active" }),
      household.collection("members").doc("member-a").set({ displayName: "민규" }),
      database.collection("recurring_expenses").doc("legacy-no-creator").set({
        householdId: HOUSEHOLD_ID,
        merchant: "정기 거래",
        amount: 10_000,
        category: "etc",
        dayOfMonth: 1,
      }),
    ]);
    const migration = subject();
    const dryRun = await migration.dryRun({
      scope: scope("unresolved"),
      mappings: mappings({ memberReferences: {}, recurringCreators: {}, assetOwners: {}, positionMarkets: {} }),
      plannedAt: "2026-07-21T01:00:00.000Z",
    });
    expect(dryRun.unresolved).toEqual([
      expect.objectContaining({
        code: "RECURRING_CREATOR_MAPPING_REQUIRED",
        requiredManifestField: "recurringCreators",
      }),
    ]);
    expect(
      await migration.apply({
        scope: scope("unresolved"),
        expectedPlanHash: dryRun.planHash,
        confirmation: "APPLY",
        pageSize: 50,
        maxPages: 100,
        appliedAt: "2026-07-21T01:01:00.000Z",
      }),
    ).toMatchObject({
      kind: "blocked",
      code: "MIGRATION_UNRESOLVED_REFERENCES",
    });
    expect((await household.collection("recurringPlans").get()).size).toBe(0);
  });

  it("카드 소유자와 중복 지역화폐 선택이 불명확하면 임의 추정 없이 전체 apply를 차단한다", async () => {
    const household = database.collection("households").doc(HOUSEHOLD_ID);
    await Promise.all([
      household.set({ lifecycleState: "active" }),
      household.collection("members").doc("member-a").set({
        memberId: "member-a",
        displayName: "민규",
      }),
      database.collection("registered_cards").doc("card-unmapped").set({
        householdId: HOUSEHOLD_ID,
        owner: "unknown-owner",
        cardLabel: "Example Card",
        cardLastFour: "9999",
      }),
      database.collection("balances").doc("balance-one").set({
        householdId: HOUSEHOLD_ID,
        type: "localCurrency",
        localCurrencyType: "gyeonggi",
        balance: 10_000,
      }),
      database.collection("balances").doc("balance-two").set({
        householdId: HOUSEHOLD_ID,
        type: "localCurrency",
        localCurrencyType: "gyeonggi",
        balance: 20_000,
      }),
    ]);

    const migration = subject();
    const dryRun = await migration.dryRun({
      scope: scope("ambiguous-configuration"),
      mappings: mappings({
        memberReferences: {},
        registeredCardOwners: {},
        localCurrencyPreferredDocuments: {},
      }),
      plannedAt: "2026-07-21T01:30:00.000Z",
    });

    expect(dryRun.unresolved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "REGISTERED_CARD_OWNER_MAPPING_REQUIRED",
          requiredManifestField: "registeredCardOwners",
        }),
        expect.objectContaining({
          code: "LOCAL_CURRENCY_DUPLICATE_SELECTION_REQUIRED",
          requiredManifestField: "localCurrencyPreferredDocuments",
        }),
      ]),
    );
    expect(
      await migration.apply({
        scope: scope("ambiguous-configuration"),
        expectedPlanHash: dryRun.planHash,
        confirmation: "APPLY",
        pageSize: 50,
        maxPages: 100,
        appliedAt: "2026-07-21T01:31:00.000Z",
      }),
    ).toMatchObject({
      kind: "blocked",
      code: "MIGRATION_UNRESOLVED_REFERENCES",
    });
    expect((await household.collection("registeredCards").get()).size).toBe(0);
    expect((await household.collection("localCurrencyBalances").get()).size).toBe(0);
  });

  it("dry-run 뒤 source가 바뀌면 해당 page 전체를 rollback한다", async () => {
    const household = database.collection("households").doc(HOUSEHOLD_ID);
    await Promise.all([
      household.set({ lifecycleState: "active" }),
      household.collection("members").doc("member-a").set({ displayName: "민규" }),
      database.collection("expenses").doc("expense-drift").set({
        householdId: HOUSEHOLD_ID,
        merchant: "원본",
        amount: 10_000,
        category: "etc",
        date: "2026-07-20",
        createdBy: "member-a",
      }),
    ]);
    const migration = subject();
    const dryRun = await migration.dryRun({
      scope: scope("source-drift"),
      mappings: mappings(),
      plannedAt: "2026-07-21T02:00:00.000Z",
    });
    await database.collection("expenses").doc("expense-drift").update({ amount: 20_000 });

    expect(
      await migration.apply({
        scope: scope("source-drift"),
        expectedPlanHash: dryRun.planHash,
        confirmation: "APPLY",
        pageSize: 50,
        maxPages: 100,
        appliedAt: "2026-07-21T02:01:00.000Z",
      }),
    ).toMatchObject({ kind: "blocked", code: "MIGRATION_SOURCE_CHANGED" });
    expect((await household.collection("ledgerTransactions").get()).size).toBe(0);
    expect((await database.collection("operationsMigrationPageReceipts").get()).size).toBe(0);
  });

  it("dry-run 뒤 충돌 target이 생기면 기존 값을 덮어쓰지 않는다", async () => {
    const household = database.collection("households").doc(HOUSEHOLD_ID);
    await Promise.all([
      household.set({ lifecycleState: "active" }),
      household.collection("members").doc("member-a").set({ displayName: "민규" }),
      database.collection("expenses").doc("expense-conflict").set({
        householdId: HOUSEHOLD_ID,
        merchant: "legacy",
        amount: 10_000,
        category: "etc",
        date: "2026-07-20",
        createdBy: "member-a",
      }),
    ]);
    const migration = subject();
    const dryRun = await migration.dryRun({
      scope: scope("target-conflict"),
      mappings: mappings(),
      plannedAt: "2026-07-21T03:00:00.000Z",
    });
    await household.collection("ledgerTransactions").doc("expense-conflict").set({
      householdId: HOUSEHOLD_ID,
      amountInWon: 777,
      creatorMemberId: "member-a",
    });

    expect(
      await migration.apply({
        scope: scope("target-conflict"),
        expectedPlanHash: dryRun.planHash,
        confirmation: "APPLY",
        pageSize: 50,
        maxPages: 100,
        appliedAt: "2026-07-21T03:01:00.000Z",
      }),
    ).toMatchObject({ kind: "blocked", code: "MIGRATION_TARGET_CONFLICT" });
    expect((await household.collection("ledgerTransactions").doc("expense-conflict").get()).data()?.amountInWon).toBe(777);
    expect((await database.collection("operationsMigrationPageReceipts").get()).size).toBe(0);
  });
});
