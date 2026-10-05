import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { sha256 } from "../../../src/adapters/firebase/access/firebaseAccessPersistence";
import { FirebaseGoogleOnboardingStore } from "../../../src/adapters/firebase/access/firebaseGoogleOnboardingStore";
import { createHouseholdWithSelf } from "../../../src/contexts/access/google-onboarding/application/googleOnboardingApplication";
import { createAccessHouseholdCommandHandlers } from "../../../src/bootstrap/commands/accessHouseholdCommandHandlers";
import { createAdminAccessRouter } from "../../../src/bootstrap/admin/adminAccess";
import { createAdminHouseholdAccessHandlers } from "../../../src/bootstrap/admin/handlers/adminHouseholdAccessHandlers";
import { createAdminMemberAccessHandlers } from "../../../src/bootstrap/admin/handlers/adminMemberAccessHandlers";
import { principalClaimId } from "../../../src/adapters/firebase/access/firebasePrincipalMembershipClaim";
import { resolveFirebaseSignedInUser } from "../../../src/adapters/firebase/access/firebaseSignedInUserResolver";
import { verifiedSystemAdministrator } from "../../../src/bootstrap/verifiedSystemAdministrator";
import { FirebaseHouseholdCommandMembershipAdapter } from "../../../src/adapters/firebase/commands/firebaseHouseholdCommandInfrastructure";
import type {
  HouseholdCommandActor,
  HouseholdCommandExecutionContext,
} from "../../../src/bootstrap/commands/householdCommand";

const PROJECT_ID = "demo-household-account-access-adapters";
const REQUESTED_AT = "2026-07-21T09:00:00.000Z";
const describeWithFirestoreEmulator = process.env.FIRESTORE_EMULATOR_HOST
  ? describe
  : describe.skip;

let app: App;
let database: Firestore;

function context(input: {
  principalUid: string;
  command: string;
  commandId: string;
  idempotencyKey?: string;
  payload: Record<string, unknown>;
  householdId?: string;
  actor?: HouseholdCommandActor;
}): HouseholdCommandExecutionContext {
  return {
    principalUid: input.principalUid,
    requestedAt: REQUESTED_AT,
    envelope: {
      contractVersion: "household-command.v1",
      commandId: input.commandId,
      idempotencyKey: input.idempotencyKey ?? input.commandId,
      command: input.command,
      payload: input.payload,
      ...(input.householdId === undefined
        ? {}
        : { householdId: input.householdId }),
    },
    ...(input.actor === undefined ? {} : { actor: input.actor }),
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

describeWithFirestoreEmulator("Firebase Access command adapters", () => {
  beforeAll(() => {
    app = initializeApp({ projectId: PROJECT_ID }, `access-adapters-${Date.now()}`);
    database = getFirestore(app);
  });

  beforeEach(clearEmulator);

  afterAll(async () => {
    if (app !== undefined) await deleteApp(app);
  });

  it("[T-HH-003] 같은 저장소 재호출도 receipt를 재생하고 초기화 완료·삭제를 되돌리지 않는다", async () => {
    const store = new FirebaseGoogleOnboardingStore(database, {
      principalUid: "repeat-user", idempotencyKey: "repeat", payloadFingerprint: "same-input",
      commandId: "repeat", requestedAt: REQUESTED_AT,
      mode: { kind: "create", householdId: "repeat-house", memberId: "repeat-member" },
    });
    let outcome: "failed" | "completed" = "failed";
    const dependencies = { store,
      identities: { nextHouseholdId: () => "repeat-house", nextMemberId: () => "repeat-member" },
      initializer: { initialize: async () => outcome },
    };
    const create = () => createHouseholdWithSelf(dependencies, { uid: "repeat-user" }, {
      householdName: "재시도", selfDisplayName: "본인", idempotencyKey: "repeat",
    });
    expect(await create()).toMatchObject({ kind: "success", initializationStatus: "failed" });
    outcome = "completed";
    expect(await create()).toMatchObject({ kind: "success", initializationStatus: "completed" });
    const household = database.doc("households/repeat-house");
    const profile = (await household.collection("assetOwnerProfiles").get()).docs[0]!;
    await profile.ref.update({ displayName: "수정한 명의", aggregateVersion: 4 });
    outcome = "failed";
    expect(await create()).toMatchObject({ kind: "success", initializationStatus: "completed" });
    expect((await profile.ref.get()).data()).toMatchObject({ displayName: "수정한 명의", aggregateVersion: 4 });
    expect((await household.collection("members").get()).size).toBe(1);
    expect((await database.collection("outboxEvents").where("householdId", "==", household.id).get()).size).toBe(2);
    await household.update({ lifecycleState: "deleted" });
    expect(await create()).toMatchObject({ kind: "success", initializationStatus: "failed" });
    expect((await household.get()).data()).toMatchObject({ lifecycleState: "deleted", initializationStatus: "completed" });
  });

  it("신규 가구부터 논리 삭제까지 canonical identity graph와 업무 데이터를 원자적으로 보존한다", async () => {
    const handlers = createAccessHouseholdCommandHandlers(database);
    const creatorUid = "uid-access-creator";
    const created = (await handlers
      .get("access.create-household-with-self.v1")!
      .execute(
        context({
          principalUid: creatorUid,
          command: "access.create-household-with-self.v1",
          commandId: "create-household-1",
          payload: { householdName: "테스트", memberName: "민규" },
        }),
      )) as { householdId: string; memberId: string };

    const actor: HouseholdCommandActor = {
      principalUid: creatorUid,
      householdId: created.householdId,
      actingMemberId: created.memberId,
      capabilities: [
        "household.read",
        "household.write",
        "household.asset-owner-profile.write",
      ],
    };
    const householdReference = database.collection("households").doc(created.householdId);
    const [household, member, membership, view, claim, memberProfile] =
      await Promise.all([
        householdReference.get(),
        householdReference.collection("members").doc(created.memberId).get(),
        householdReference.collection("memberships").doc(creatorUid).get(),
        database
          .collection("users")
          .doc(creatorUid)
          .collection("householdMembershipViews")
          .doc(created.householdId)
          .get(),
        database.collection("principalMembershipClaims").doc(sha256(creatorUid)).get(),
        householdReference
          .collection("assetOwnerProfiles")
          .where("linkedMemberId", "==", created.memberId)
          .get(),
      ]);
    expect(household.data()).toMatchObject({
      name: "테스트네",
      lifecycleState: "active",
      aggregateVersion: 1,
      initializationStatus: "completed",
    });
    expect(created.householdId).toMatch(/^[0-9a-f]{32}$/u);
    expect(member.data()).toMatchObject({
      linkedPrincipalUid: creatorUid,
      displayName: "민규",
    });
    expect(membership.data()).toMatchObject({ memberId: created.memberId });
    expect(view.data()).toMatchObject({ memberId: created.memberId, displayName: "민규" });
    expect(claim.data()).toMatchObject({
      householdId: created.householdId,
      memberId: created.memberId,
    });
    expect(memberProfile.size).toBe(1);
    const initializedCatalog = await householdReference
      .collection("categoryCatalog")
      .doc("current")
      .get();
    expect(
      initializedCatalog.data()!.categories
        .map((category: { categoryId: string }) => category.categoryId)
        .sort(),
    ).toEqual(["childcare", "etc", "fixed", "food", "living"]);
    expect(initializedCatalog.data()).toMatchObject({
      schemaVersion: 1,
      householdId: created.householdId,
      defaultCategoryId: "etc",
      catalogVersion: 1,
    });
    expect((await householdReference.collection("categories").get()).empty).toBe(true);
    expect((await householdReference.collection("categorySettings").get()).empty).toBe(true);
    expect((await database.collection("categories").get()).empty).toBe(true);

    const invitation = (await handlers
      .get("access.create-invitation.v1")!
      .execute(
        context({
          principalUid: creatorUid,
          householdId: created.householdId,
          actor,
          command: "access.create-invitation.v1",
          commandId: "create-invitation-1",
          payload: {},
        }),
      )) as { invitationCode: string; expiresAt: string };
    expect(Date.parse(invitation.expiresAt) - Date.parse(REQUESTED_AT)).toBe(
      5 * 60 * 1_000,
    );
    const invitationSnapshot = await database
      .collection("householdInvitations")
      .doc(sha256(invitation.invitationCode))
      .get();
    expect(invitationSnapshot.data()).toMatchObject({
      householdId: created.householdId,
      status: "issued",
    });
    expect(JSON.stringify(invitationSnapshot.data())).not.toContain(
      invitation.invitationCode,
    );

    const inviteeUid = "uid-access-invitee";
    const joined = (await handlers
      .get("access.join-household-as-self.v1")!
      .execute(
        context({
          principalUid: inviteeUid,
          command: "access.join-household-as-self.v1",
          commandId: "join-household-1",
          payload: { invitationCode: invitation.invitationCode, memberName: "진선" },
        }),
      )) as { householdId: string; memberId: string };
    expect(joined.householdId).toBe(created.householdId);
    expect(
      (
        await database
          .collection("householdInvitations")
          .doc(sha256(invitation.invitationCode))
          .get()
      ).data(),
    ).toMatchObject({ status: "used", usedByUid: inviteeUid });
    expect(
      (
        await householdReference
          .collection("memberships")
          .doc(inviteeUid)
          .get()
      ).data(),
    ).toMatchObject({ memberId: joined.memberId });
    expect((await householdReference.collection("members").get()).size).toBe(2);

    await expect(
      handlers.get("access.join-household-as-self.v1")!.execute(
        context({
          principalUid: "uid-access-third",
          command: "access.join-household-as-self.v1",
          commandId: "join-household-reused-invitation",
          payload: { invitationCode: invitation.invitationCode, memberName: "제3자" },
        }),
      ),
    ).rejects.toMatchObject({ code: "INVITATION_EXPIRED_OR_USED" });
    expect((await householdReference.collection("members").get()).size).toBe(2);

    await expect(
      handlers.get("access.create-household-with-self.v1")!.execute(
        context({
          principalUid: inviteeUid,
          command: "access.create-household-with-self.v1",
          commandId: "duplicate-principal-household",
          payload: { householdName: "중복 가계부", memberName: "진선" },
        }),
      ),
    ).rejects.toMatchObject({ code: "PRINCIPAL_ALREADY_JOINED" });

    const dependent = (await handlers
      .get("access.create-asset-owner-profile.v1")!
      .execute(
        context({
          principalUid: creatorUid,
          householdId: created.householdId,
          actor,
          command: "access.create-asset-owner-profile.v1",
          commandId: "create-dependent-profile-1",
          payload: { displayName: "지아" },
        }),
      )) as { profileId: string };
    expect(
      (
        await householdReference
          .collection("assetOwnerProfiles")
          .doc(dependent.profileId)
          .get()
      ).data(),
    ).toMatchObject({ profileType: "dependent", displayName: "지아" });
    expect(
      await householdReference.collection("members").doc(dependent.profileId).get(),
    ).toMatchObject({ exists: false });

    await householdReference.collection("ledgerTransactions").doc("keep-me").set({
      amountInWon: 10_000,
    });
    expect(handlers.has("access.request-household-deletion.v1")).toBe(false);
    const administratorUid = "uid-access-administrator";
    const adminRouter = createAdminAccessRouter({ handlers: new Map(createAdminHouseholdAccessHandlers(database)) });
    await expect(adminRouter.execute({
      principalUid: administratorUid,
      administrator: verifiedSystemAdministrator(administratorUid, { systemAdmin: true }),
      requestedAt: REQUESTED_AT,
      request: {
        contractVersion: "admin-access.v1", requestId: "delete-household-1", idempotencyKey: "delete-household-1",
        operation: "delete-household", payload: { householdId: created.householdId, confirmed: true, expectedVersion: 1 },
      },
    })).resolves.toMatchObject({ kind: "success" });
    await expect(new FirebaseHouseholdCommandMembershipAdapter(database).resolveActor({
      principalUid: creatorUid, householdId: created.householdId,
    })).resolves.toEqual({ kind: "household-not-active" });
    expect((await householdReference.get()).data()).toMatchObject({
      lifecycleState: "deleted",
      aggregateVersion: 2,
    });
    expect(
      await householdReference.collection("ledgerTransactions").doc("keep-me").get(),
    ).toMatchObject({ exists: true });

    const outbox = await database.collection("outboxEvents").get();
    expect(outbox.docs.map((snapshot) => snapshot.data().eventType).sort()).toEqual([
      "AssetOwnerProfileChanged",
      "CategoryCatalogChanged",
      "HouseholdCreated",
      "HouseholdDeleted",
      "MemberJoined",
      "MemberJoined",
    ]);
    const onboardingReceipts = await database
      .collection("commandReceipts")
      .doc("access-google-onboarding")
      .collection("receipts")
      .get();
    expect(JSON.stringify(onboardingReceipts.docs.map((item) => item.data()))).not.toContain(
      invitation.invitationCode,
    );
  });

  it("[T-HH-003] 같은 초대의 동시 소비는 한 가입자의 identity graph만 저장한다", async () => {
    const handlers = createAccessHouseholdCommandHandlers(database);
    const created = await handlers.get("access.create-household-with-self.v1")!.execute(context({
      principalUid: "inviter", command: "access.create-household-with-self.v1", commandId: "race-house",
      payload: { householdName: "초대 경합", memberName: "본인" },
    })) as { householdId: string; memberId: string };
    const actor = { principalUid: "inviter", householdId: created.householdId, actingMemberId: created.memberId,
      capabilities: ["household.read", "household.write"] };
    const invitation = await handlers.get("access.create-invitation.v1")!.execute(context({
      principalUid: "inviter", householdId: created.householdId, actor,
      command: "access.create-invitation.v1", commandId: "race-invite", payload: {},
    })) as { invitationCode: string };
    const results = await Promise.allSettled(["first", "second"].map(principalUid =>
      handlers.get("access.join-household-as-self.v1")!.execute(context({
        principalUid, command: "access.join-household-as-self.v1", commandId: `join-${principalUid}`,
        payload: { invitationCode: invitation.invitationCode, memberName: principalUid },
      }))));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: "INVITATION_EXPIRED_OR_USED" }) }),
    ]);
    const household = database.doc(`households/${created.householdId}`);
    for (const collection of ["members", "memberships", "assetOwnerProfiles"]) {
      expect((await household.collection(collection).get()).size).toBe(2);
    }
    expect((await database.collection("principalMembershipClaims").where("householdId", "==", created.householdId).get()).size).toBe(2);
    expect((await database.collection("outboxEvents").where("householdId", "==", created.householdId).get()).size).toBe(4);
  }, 30_000);

  it("[T-HH-007][HH-012] 제거된 멤버 복구와 실제 다른 가구 가입이 경합해도 UID claim 하나만 확정한다", async () => {
    const handlers = createAccessHouseholdCommandHandlers(database);
    const created = [] as { householdId: string; memberId: string }[];
    const invitations = [] as string[];
    for (const principalUid of ["owner-a", "owner-b"]) {
      const house = await handlers.get("access.create-household-with-self.v1")!.execute(context({
        principalUid, command: "access.create-household-with-self.v1", commandId: principalUid,
        payload: { householdName: principalUid, memberName: principalUid },
      })) as { householdId: string; memberId: string };
      created.push(house);
      const invite = await handlers.get("access.create-invitation.v1")!.execute(context({
        principalUid, householdId: house.householdId,
        actor: { principalUid, householdId: house.householdId, actingMemberId: house.memberId, capabilities: ["household.read", "household.write"] },
        command: "access.create-invitation.v1", commandId: `invite-${principalUid}`, payload: {},
      })) as { invitationCode: string };
      invitations.push(invite.invitationCode);
    }
    const join = (index: number) => handlers.get("access.join-household-as-self.v1")!.execute(context({
      principalUid: "removed-user", command: "access.join-household-as-self.v1", commandId: `join-${index}`,
      payload: { invitationCode: invitations[index], memberName: "가구원" },
    })) as Promise<{ householdId: string; memberId: string }>;
    const original = await join(0);
    const router = createAdminAccessRouter({ handlers: new Map(createAdminMemberAccessHandlers(database)) });
    const admin = (operation: "remove-household-member" | "restore-household-member", expectedVersion: number) => router.execute({
      principalUid: "admin", administrator: verifiedSystemAdministrator("admin", { systemAdmin: true }), requestedAt: REQUESTED_AT,
      request: { contractVersion: "admin-access.v1", requestId: operation, idempotencyKey: operation,
        operation, payload: { ...original, expectedVersion, ...(operation === "remove-household-member" ? { reason: "테스트" } : {}) } },
    });
    expect(await admin("remove-household-member", 1)).toMatchObject({ kind: "success" });
    expect(await resolveFirebaseSignedInUser(database, "removed-user")).toMatchObject({ kind: "first-visit-required" });
    const results = await Promise.all([
      admin("restore-household-member", 2),
      join(1).then(value => ({ kind: "success", data: value }), (error: { code: string }) => ({ kind: "error", code: error.code })),
    ]);
    expect(results.filter(result => result.kind === "success")).toHaveLength(1);
    expect(results.filter(result => result.kind !== "success")).toEqual([expect.objectContaining({ code: "PRINCIPAL_ALREADY_JOINED" })]);
    const claims = await database.collection("principalMembershipClaims").where("principalUid", "==", "removed-user").get();
    expect(claims.size).toBe(1);
    expect(claims.docs[0]!.id).toBe(principalClaimId("removed-user"));
    const winner = claims.docs[0]!.data();
    expect(created.map(house => house.householdId)).toContain(winner.householdId);
    expect(await resolveFirebaseSignedInUser(database, "removed-user")).toMatchObject({
      kind: "membership-found", membership: { householdId: winner.householdId, memberId: winner.memberId },
    });
  }, 30_000);

  it("legacy 가구는 stable 가구·멤버와 선택적 이름을 검증한 뒤 기존 업무 데이터 없이 연결만 추가한다", async () => {
    const handlers = createAccessHouseholdCommandHandlers(database);
    const householdId = "legacy-household-a";
    const memberId = "legacy-member-a";
    const householdReference = database.collection("households").doc(householdId);
    await householdReference.set({
      name: "기존 가계부",
      members: [{ id: memberId, name: "민규", aggregateVersion: 3 }],
      createdAt: new Date("2020-01-01T00:00:00.000Z"),
    });
    await householdReference.collection("ledgerTransactions").doc("old-ledger").set({
      amountInWon: 30_000,
    });

    await expect(
      handlers.get("access.claim-legacy-membership.v1")!.execute(
        context({
          principalUid: "uid-wrong-name",
          command: "access.claim-legacy-membership.v1",
          commandId: "legacy-wrong-name",
          payload: {
            legacyHouseholdId: householdId,
            legacyMemberId: memberId,
            legacyMemberName: "다른 이름",
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "LEGACY_MEMBERSHIP_NOT_FOUND" });

    const principalUid = "uid-legacy-owner";
    const result = await handlers
      .get("access.claim-legacy-membership.v1")!
      .execute(
        context({
          principalUid,
          command: "access.claim-legacy-membership.v1",
          commandId: "legacy-claim-1",
          payload: {
            legacyHouseholdId: householdId,
            legacyMemberId: memberId,
            legacyMemberName: "민규",
          },
        }),
      );
    expect(result).toEqual({ householdId, memberId });
    expect(
      (await householdReference.collection("members").doc(memberId).get()).data(),
    ).toMatchObject({ linkedPrincipalUid: principalUid, displayName: "민규" });
    expect(
      (await householdReference.collection("memberships").doc(principalUid).get()).data(),
    ).toMatchObject({ householdId, memberId });
    expect(
      await householdReference.collection("ledgerTransactions").doc("old-ledger").get(),
    ).toMatchObject({ exists: true });
    expect((await database.collection("legacyMembershipClaims").get()).size).toBe(1);

    await expect(
      handlers.get("access.claim-legacy-membership.v1")!.execute(
        context({
          principalUid: "uid-legacy-other",
          command: "access.claim-legacy-membership.v1",
          commandId: "legacy-claim-conflict",
          payload: {
            legacyHouseholdId: householdId,
            legacyMemberId: memberId,
            legacyMemberName: "민규",
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "MEMBER_ALREADY_LINKED" });
  });

  it("여러 신규 가구의 같은 기본 카테고리를 가구별 catalog 단일 문서로 격리한다", async () => {
    const handlers = createAccessHouseholdCommandHandlers(database);
    const households: Array<{ householdId: string; memberId: string }> = [];
    for (const input of [
      {
        principalUid: "uid-default-category-a",
        commandId: "create-default-category-household-a",
        householdName: "첫 번째",
        memberName: "첫째",
      },
      {
        principalUid: "uid-default-category-b",
        commandId: "create-default-category-household-b",
        householdName: "두 번째",
        memberName: "둘째",
      },
    ]) {
      households.push(
        (await handlers
          .get("access.create-household-with-self.v1")!
          .execute(
            context({
              principalUid: input.principalUid,
              command: "access.create-household-with-self.v1",
              commandId: input.commandId,
              payload: {
                householdName: input.householdName,
                memberName: input.memberName,
              },
            }),
          )) as { householdId: string; memberId: string },
      );
    }

    const catalogs = await Promise.all(
      households.map(({ householdId }) =>
        database
          .collection("households")
          .doc(householdId)
          .collection("categoryCatalog")
          .doc("current")
          .get(),
      ),
    );
    for (const [index, catalog] of catalogs.entries()) {
      expect(catalog.data()).toMatchObject({
        householdId: households[index]!.householdId,
        defaultCategoryId: "etc",
        catalogVersion: 1,
      });
      expect(
        catalog.data()!.categories.map((category: { categoryId: string }) => category.categoryId).sort(),
      ).toEqual(["childcare", "etc", "fixed", "food", "living"]);
      expect(
        (
          await database
            .collection("households")
            .doc(households[index]!.householdId)
            .collection("categories")
            .get()
        ).size,
      ).toBe(0);
    }
    expect(catalogs[0]!.ref.path).not.toBe(catalogs[1]!.ref.path);
    expect((await database.collection("categories").get()).empty).toBe(true);
  });
});
