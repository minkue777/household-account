import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { sha256 } from "../../../src/adapters/firebase/access/firebaseAccessPersistence";
import { createAccessHouseholdCommandHandlers } from "../../../src/bootstrap/commands/accessHouseholdCommandHandlers";
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
          payload: { householdName: "테스트 가계부", memberName: "민규" },
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
        "household.delete",
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
      lifecycleState: "active",
      aggregateVersion: 1,
      initializationStatus: "pending",
    });
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
    await handlers
      .get("access.request-household-deletion.v1")!
      .execute(
        context({
          principalUid: creatorUid,
          householdId: created.householdId,
          actor,
          command: "access.request-household-deletion.v1",
          commandId: "delete-household-1",
          payload: {},
        }),
      );
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
});
