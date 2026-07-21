import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createAccessHouseholdCommandHandlers } from "../../../src/bootstrap/commands/accessHouseholdCommandHandlers";
import type {
  HouseholdAdministratorActor,
  HouseholdCommandActor,
  HouseholdCommandExecutionContext,
} from "../../../src/bootstrap/commands/householdCommand";
import { createAccessHouseholdQueryHandlers } from "../../../src/bootstrap/queries/accessHouseholdQueryHandlers";

const PROJECT_ID = "demo-household-account-owner-profile-runtime";
const HOUSEHOLD_ID = "house-owner-profile";
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

const memberActor: HouseholdCommandActor = {
  principalUid: "uid-member",
  householdId: HOUSEHOLD_ID,
  actingMemberId: "member-a",
  capabilities: ["household.asset-owner-profile.write"],
};

const administrator: HouseholdAdministratorActor = {
  principalRef: "uid-admin",
  capabilities: ["admin.asset-owner-profile.archive"],
};

function command(input: {
  name: string;
  id: string;
  principalUid: string;
  payload: Record<string, unknown>;
  actor?: HouseholdCommandActor;
  administrator?: HouseholdAdministratorActor;
}): HouseholdCommandExecutionContext {
  return {
    principalUid: input.principalUid,
    requestedAt: NOW,
    envelope: {
      contractVersion: "household-command.v1",
      commandId: input.id,
      idempotencyKey: input.id,
      householdId: HOUSEHOLD_ID,
      command: input.name,
      payload: input.payload,
    },
    ...(input.actor === undefined ? {} : { actor: input.actor }),
    ...(input.administrator === undefined
      ? {}
      : { administrator: input.administrator }),
  };
}

describeWithFirestoreEmulator("자산 명의자 production runtime", () => {
  beforeAll(() => {
    app = initializeApp({ projectId: PROJECT_ID }, `owner-profile-${Date.now()}`);
    database = getFirestore(app);
  });

  beforeEach(async () => {
    await clearEmulator();
    const household = database.collection("households").doc(HOUSEHOLD_ID);
    await Promise.all([
      household.set({
        name: "명의자 가계부",
        lifecycleState: "active",
        aggregateVersion: 1,
        createdAt: NOW,
      }),
      household.collection("members").doc("member-a").set({
        linkedPrincipalUid: "uid-member",
        displayName: "민규",
        aggregateVersion: 1,
      }),
      household.collection("memberships").doc("uid-member").set({
        householdId: HOUSEHOLD_ID,
        memberId: "member-a",
        lifecycleState: "active",
        capabilities: ["household.asset-owner-profile.write"],
      }),
      household.collection("assetOwnerProfiles").doc("profile-dependent-jia").set({
        householdId: HOUSEHOLD_ID,
        profileId: "profile-dependent-jia",
        displayName: "지아",
        profileType: "dependent",
        lifecycleState: "active",
        aggregateVersion: 3,
      }),
    ]);
  });

  afterAll(async () => {
    if (app !== undefined) await deleteApp(app);
  });

  it("일반 멤버 rename은 profileId를 유지해 실제 문서를 version과 함께 갱신한다", async () => {
    const handlers = createAccessHouseholdCommandHandlers(database);
    const result = await handlers.get("access.rename-asset-owner-profile.v1")!.execute(
      command({
        name: "access.rename-asset-owner-profile.v1",
        id: "rename-profile-1",
        principalUid: memberActor.principalUid,
        actor: memberActor,
        payload: {
          profileId: "profile-dependent-jia",
          displayName: "지아(변경)",
          expectedVersion: 3,
        },
      }),
    );
    expect(result).toMatchObject({
      profileId: "profile-dependent-jia",
      displayName: "지아(변경)",
      aggregateVersion: 4,
    });
    expect(
      (
        await database
          .collection("households")
          .doc(HOUSEHOLD_ID)
          .collection("assetOwnerProfiles")
          .doc("profile-dependent-jia")
          .get()
      ).data(),
    ).toMatchObject({
      displayName: "지아(변경)",
      lifecycleState: "active",
      aggregateVersion: 4,
    });
  });

  it("archive는 검증된 관리자 context에서만 보관하고 일반 사용자 복구 API는 제공하지 않는다", async () => {
    const handlers = createAccessHouseholdCommandHandlers(database);
    await expect(
      handlers.get("access.archive-asset-owner-profile.v1")!.execute(
        command({
          name: "access.archive-asset-owner-profile.v1",
          id: "archive-profile-denied",
          principalUid: memberActor.principalUid,
          actor: memberActor,
          payload: { profileId: "profile-dependent-jia", expectedVersion: 3 },
        }),
      ),
    ).rejects.toMatchObject({ code: "PROFILE_ARCHIVE_FORBIDDEN" });

    await handlers.get("access.archive-asset-owner-profile.v1")!.execute(
      command({
        name: "access.archive-asset-owner-profile.v1",
        id: "archive-profile-1",
        principalUid: administrator.principalRef,
        administrator,
        payload: { profileId: "profile-dependent-jia", expectedVersion: 3 },
      }),
    );
    const profile = await database
      .collection("households")
      .doc(HOUSEHOLD_ID)
      .collection("assetOwnerProfiles")
      .doc("profile-dependent-jia")
      .get();
    expect(profile.data()).toMatchObject({
      lifecycleState: "archived",
      aggregateVersion: 4,
    });

    const query = createAccessHouseholdQueryHandlers(database).get(
      "access.list-asset-owner-profiles.v1",
    )!;
    await expect(
      query.execute({
        principalUid: administrator.principalRef,
        administrator,
        envelope: {
          contractVersion: "household-query.v1",
          queryId: "list-archived-1",
          householdId: HOUSEHOLD_ID,
          query: "access.list-asset-owner-profiles.v1",
          payload: { includeArchived: true },
        },
      }),
    ).resolves.toEqual({
      profiles: [expect.objectContaining({
        profileId: "profile-dependent-jia",
        lifecycleState: "archived",
      })],
    });
  });
});
