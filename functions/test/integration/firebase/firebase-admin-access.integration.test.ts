import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createAdminAccessRouter } from "../../../src/bootstrap/admin/adminAccess";
import type { AdminAccessOperation } from "../../../src/bootstrap/admin/adminAccess";
import { createFirebaseAdminAccessHandlers } from "../../../src/bootstrap/firebaseAdminAccess";
import { verifiedSystemAdministrator } from "../../../src/bootstrap/verifiedSystemAdministrator";
import { principalClaimId } from "../../../src/adapters/firebase/access/firebaseAccessPersistence";

const PROJECT_ID = "demo-household-account-admin-access";
const NOW = "2026-07-21T09:00:00.000Z";
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

function envelope(
  operation: AdminAccessOperation,
  payload: Record<string, unknown>,
  id: string,
) {
  return {
    contractVersion: "admin-access.v1",
    requestId: id,
    idempotencyKey: id,
    operation,
    payload,
  };
}

describeWithFirestoreEmulator("Firebase 관리자 Access adapter", () => {
  beforeAll(() => {
    app = initializeApp({ projectId: PROJECT_ID }, `admin-access-${Date.now()}`);
    database = getFirestore(app);
  });

  beforeEach(clearEmulator);

  afterAll(async () => {
    if (app !== undefined) await deleteApp(app);
  });

  it("관리자 생성·목록·키 조회·논리 삭제를 서버 capability와 원자 기록으로 수행한다", async () => {
    const router = createAdminAccessRouter({
      handlers: createFirebaseAdminAccessHandlers(database),
    });
    const administrator = verifiedSystemAdministrator("uid-admin", {
      systemAdmin: true,
    });
    const execute = (request: unknown) =>
      router.execute({
        principalUid: "uid-admin",
        administrator,
        request,
        requestedAt: NOW,
      });

    const created = await execute(
      envelope("create-household", { name: "운영 생성 가계부" }, "admin-create-1"),
    );
    expect(created).toMatchObject({
      kind: "success",
      data: {
        householdId: expect.any(String),
        name: "운영 생성 가계부",
        lifecycleState: "active",
        aggregateVersion: 1,
      },
    });
    if (created.kind !== "success") throw new Error("관리자 생성 실패");
    const householdId = (created.data as { householdId: string }).householdId;

    await expect(
      execute(envelope("list-households", { limit: 10 }, "admin-list-1")),
    ).resolves.toMatchObject({
      kind: "success",
      data: { items: [expect.objectContaining({ householdId })] },
    });
    await expect(
      execute(
        envelope(
          "get-legacy-share-key",
          { householdId },
          "admin-key-1",
        ),
      ),
    ).resolves.toMatchObject({
      kind: "success",
      data: { legacyShareKey: householdId },
    });

    await expect(
      execute(
        envelope(
          "delete-household",
          { householdId, confirmed: true, expectedVersion: 1 },
          "admin-delete-1",
        ),
      ),
    ).resolves.toMatchObject({
      kind: "success",
      data: { householdId, lifecycleState: "deleted", aggregateVersion: 2 },
    });
    const household = await database.collection("households").doc(householdId).get();
    expect(household.data()).toMatchObject({
      lifecycleState: "deleted",
      aggregateVersion: 2,
      deletedAt: NOW,
    });
    expect((await database.collection("outboxEvents").get()).docs.map((item) => item.data().eventType)).toEqual(
      expect.arrayContaining(["HouseholdCreated", "HouseholdDeleted"]),
    );

    await expect(
      execute(
        envelope(
          "restore-household",
          { householdId, reason: "실수로 삭제", expectedVersion: 2 },
          "admin-restore-household-1",
        ),
      ),
    ).resolves.toMatchObject({
      kind: "success",
      data: { householdId, lifecycleState: "active", aggregateVersion: 3 },
    });
  });

  it("가구원 제거와 복구는 접근 graph와 member profile을 같은 transaction에서 전환한다", async () => {
    const householdId = "house-member-lifecycle";
    const principalUid = "uid-member";
    const memberId = "member-a";
    const household = database.collection("households").doc(householdId);
    await Promise.all([
      household.set({
        name: "가구원 생명주기",
        lifecycleState: "active",
        aggregateVersion: 1,
        createdAt: NOW,
      }),
      household.collection("members").doc(memberId).set({
        linkedPrincipalUid: principalUid,
        displayName: "가구원",
        lifecycleState: "active",
        aggregateVersion: 3,
      }),
      household.collection("memberships").doc(principalUid).set({
        principalUid,
        householdId,
        memberId,
        lifecycleState: "active",
        status: "active",
        aggregateVersion: 3,
        capabilities: ["household.read"],
      }),
      household.collection("assetOwnerProfiles").doc("profile-member-a").set({
        profileId: "profile-member-a",
        householdId,
        linkedMemberId: memberId,
        displayName: "가구원",
        profileType: "member",
        lifecycleState: "active",
        aggregateVersion: 1,
      }),
      database.collection("principalMembershipClaims").doc(principalClaimId(principalUid)).set({
        principalUid,
        householdId,
        memberId,
        lifecycleState: "active",
      }),
      database
        .collection("users")
        .doc(principalUid)
        .collection("householdMembershipViews")
        .doc(householdId)
        .set({ principalUid, householdId, memberId, lifecycleState: "active" }),
    ]);
    const router = createAdminAccessRouter({
      handlers: createFirebaseAdminAccessHandlers(database),
    });
    const administrator = verifiedSystemAdministrator("uid-admin", {
      systemAdmin: true,
    });
    const execute = (request: unknown) =>
      router.execute({
        principalUid: "uid-admin",
        administrator,
        request,
        requestedAt: NOW,
      });

    await expect(
      execute(
        envelope(
          "remove-household-member",
          {
            householdId,
            memberId,
            reason: "관리자 확인 제거",
            expectedVersion: 3,
          },
          "admin-remove-member-1",
        ),
      ),
    ).resolves.toMatchObject({
      kind: "success",
      data: { memberId, membershipStatus: "removed", membershipVersion: 4 },
    });
    expect((await household.collection("members").doc(memberId).get()).data()).toMatchObject({
      lifecycleState: "removed",
      aggregateVersion: 4,
    });
    expect(
      (await household.collection("assetOwnerProfiles").doc("profile-member-a").get()).data(),
    ).toMatchObject({ lifecycleState: "archived", aggregateVersion: 2 });
    expect(
      (
        await database
          .collection("users")
          .doc(principalUid)
          .collection("householdMembershipViews")
          .doc(householdId)
          .get()
      ).exists,
    ).toBe(false);

    await expect(
      execute(
        envelope(
          "restore-household-member",
          { householdId, memberId, expectedVersion: 4 },
          "admin-restore-member-1",
        ),
      ),
    ).resolves.toMatchObject({
      kind: "success",
      data: { memberId, membershipStatus: "active", membershipVersion: 5 },
    });
    expect((await household.collection("members").doc(memberId).get()).data()).toMatchObject({
      lifecycleState: "active",
      aggregateVersion: 5,
    });
    expect(
      (
        await database
          .collection("users")
          .doc(principalUid)
          .collection("householdMembershipViews")
          .doc(householdId)
          .get()
      ).data(),
    ).toMatchObject({ lifecycleState: "active", memberId });
  });

  it("삭제 자산 복구는 자산·레거시 projection·자동화 재개를 함께 반영한다", async () => {
    const householdId = "house-asset-restore";
    const assetId = "asset-savings";
    const household = database.collection("households").doc(householdId);
    await Promise.all([
      household.set({ name: "자산 복구", lifecycleState: "active", aggregateVersion: 1 }),
      household.collection("assets").doc(assetId).set({
        assetId,
        householdId,
        name: "적금",
        type: "savings",
        lifecycleState: "deleted",
        aggregateVersion: 4,
        deletedAt: "2026-07-01T00:00:00.000Z",
      }),
      database.collection("assets").doc(assetId).set({
        householdId,
        name: "적금",
        type: "savings",
        isActive: false,
        aggregateVersion: 4,
        deletedAt: "2026-07-01T00:00:00.000Z",
      }),
      household.collection("assetAutomationPlans").doc("plan-savings").set({
        planId: "plan-savings",
        householdId,
        assetId,
        configuredDay: 18,
        status: "suspended",
        aggregateVersion: 2,
        pendingMonths: [],
      }),
    ]);
    const router = createAdminAccessRouter({
      handlers: createFirebaseAdminAccessHandlers(database),
    });
    const administrator = verifiedSystemAdministrator("uid-admin", {
      systemAdmin: true,
    });
    const execute = (request: unknown) =>
      router.execute({
        principalUid: "uid-admin",
        administrator,
        request,
        requestedAt: NOW,
      });

    await expect(
      execute(envelope("list-deleted-assets", { householdId }, "admin-list-deleted-assets")),
    ).resolves.toMatchObject({
      kind: "success",
      data: { assets: [{ assetId, name: "적금", aggregateVersion: 4 }] },
    });
    await expect(
      execute(
        envelope(
          "restore-deleted-asset",
          { householdId, assetId, expectedVersion: 4, auditReason: "실수로 삭제" },
          "admin-restore-asset",
        ),
      ),
    ).resolves.toMatchObject({
      kind: "success",
      data: { kind: "success", asset: { assetId, lifecycleState: "active", aggregateVersion: 5 } },
    });
    expect((await household.collection("assets").doc(assetId).get()).data()).toMatchObject({
      lifecycleState: "active",
      aggregateVersion: 5,
    });
    expect((await database.collection("assets").doc(assetId).get()).data()).toMatchObject({
      isActive: true,
      aggregateVersion: 5,
    });
    expect((await household.collection("assetAutomationPlans").doc("plan-savings").get()).data()).toMatchObject({
      status: "active",
      aggregateVersion: 3,
      restorationResumeRevisions: [expect.objectContaining({ revision: 1 })],
    });
  });

  it("일반 로그인 사용자는 같은 요청으로 전역 목록을 읽거나 삭제할 수 없다", async () => {
    await database.collection("households").doc("house-a").set({
      name: "보호 가구",
      lifecycleState: "active",
      aggregateVersion: 1,
      createdAt: NOW,
    });
    const router = createAdminAccessRouter({
      handlers: createFirebaseAdminAccessHandlers(database),
    });
    await expect(
      router.execute({
        principalUid: "uid-user",
        administrator: undefined,
        request: envelope("list-households", {}, "admin-denied-1"),
        requestedAt: NOW,
      }),
    ).resolves.toMatchObject({ kind: "error", code: "ADMIN_CAPABILITY_REQUIRED" });
    expect((await database.collection("households").doc("house-a").get()).data()).toMatchObject({
      lifecycleState: "active",
      aggregateVersion: 1,
    });
  });
});
