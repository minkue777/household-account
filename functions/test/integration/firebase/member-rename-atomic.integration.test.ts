import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FirebaseMemberRenameStore } from "../../../src/adapters/firebase/access/firebaseMemberRenameStore";
import { createMemberRenameApplication } from "../../../src/contexts/access/member-rename/application/memberRenameApplication";

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeWithEmulator("[HH-009][T-HH-004] 실제 이름 변경의 충돌·원자성", () => {
  const app = initializeApp({ projectId: "demo-member-rename" }, "member-rename-atomic");
  const db = getFirestore(app);
  beforeAll(async () => {
    await Promise.all(["households", "users", "commandReceipts", "outboxEvents"].map(path => db.recursiveDelete(db.collection(path))));
  });
  afterAll(() => deleteApp(app));

  async function seed(householdId: string) {
    const batch = db.batch();
    batch.set(db.doc(`households/${householdId}`), { members: [{ id: "a", name: "민규" }, { id: "b", name: "진선" }] });
    for (const [memberId, displayName] of [["a", "민규"], ["b", "진선"]]) {
      batch.set(db.doc(`households/${householdId}/members/${memberId}`), {
        linkedPrincipalUid: memberId, displayName, aggregateVersion: 1, lifecycleState: "active",
      });
      batch.set(db.doc(`households/${householdId}/memberships/${memberId}`), { memberId, lifecycleState: "active" });
      batch.set(db.doc(`households/${householdId}/assetOwnerProfiles/${memberId}`), { linkedMemberId: memberId, displayName });
      batch.set(db.doc(`users/${memberId}/householdMembershipViews/${householdId}`), { displayName });
    }
    await batch.commit();
  }
  function rename(householdId: string, memberId: string, key: string, displayName: string, expectedVersion = 1) {
    return createMemberRenameApplication({ store: new FirebaseMemberRenameStore(db, householdId,
      "2026-10-05T00:00:00.000Z", `${householdId}-${key}`, { principalUid: memberId, memberId, idempotencyKey: key }) })
      .renameSelf({ householdId, principalUid: memberId, actingMemberId: memberId }, { displayName, expectedVersion, idempotencyKey: key });
  }
  async function snapshot(householdId: string) {
    const paths = [`households/${householdId}`, `households/${householdId}/members/a`,
      `households/${householdId}/assetOwnerProfiles/a`, `users/a/householdMembershipViews/${householdId}`];
    return Promise.all(paths.map(async path => (await db.doc(path).get()).data()));
  }

  it("다른 멤버의 이름은 거부하고 문서·receipt·outbox를 변경하지 않는다", async () => {
    await seed("duplicate");
    const before = await snapshot("duplicate");
    expect(await rename("duplicate", "a", "duplicate", "진선")).toEqual({ kind: "conflict", code: "DISPLAY_NAME_EXISTS" });
    expect(await snapshot("duplicate")).toEqual(before);
    expect((await db.collection("outboxEvents").where("householdId", "==", "duplicate").get()).size).toBe(0);
    expect((await db.collection("commandReceipts/access-member-rename/receipts").where("householdId", "==", "duplicate").get()).size).toBe(0);
  });

  it("두 멤버가 같은 새 이름으로 변경하면 한 명만 저장한다", async () => {
    await seed("race");
    const results = await Promise.all([rename("race", "a", "a", "새 이름"), rename("race", "b", "b", "새 이름")]);
    expect(results.filter(result => result.kind === "success")).toHaveLength(1);
    expect(results.filter(result => result.kind !== "success")).toEqual([{ kind: "conflict", code: "DISPLAY_NAME_EXISTS" }]);
    expect((await db.collection("households/race/members").where("displayName", "==", "새 이름").get()).size).toBe(1);
    expect((await db.collection("outboxEvents").where("householdId", "==", "race").get()).size).toBe(1);
  }, 30_000);

  it("성공 결과를 모든 표시 문서에 저장하고 재전송·버전 충돌·payload 충돌은 원본을 보존한다", async () => {
    await seed("replay");
    const result = await rename("replay", "a", "first", "새 민규");
    expect(result).toEqual({ kind: "success", member: { memberId: "a", displayName: "새 민규", aggregateVersion: 2 } });
    const saved = await snapshot("replay");
    expect(saved[0]?.members).toContainEqual({ id: "a", name: "새 민규", aggregateVersion: 2 });
    expect(saved.slice(1).every(value => value?.displayName === "새 민규")).toBe(true);
    expect(saved[1]?.aggregateVersion).toBe(2);
    expect(saved[3]?.memberAggregateVersion).toBe(2);
    expect(await rename("replay", "a", "first", "새 민규")).toEqual(result);
    expect(await rename("replay", "a", "first", "다른 이름")).toEqual({ kind: "conflict", code: "IDEMPOTENCY_PAYLOAD_MISMATCH" });
    expect(await rename("replay", "a", "stale", "다른 이름")).toEqual({ kind: "conflict", code: "VERSION_MISMATCH", currentVersion: 2 });
    expect(await snapshot("replay")).toEqual(saved);
    expect((await db.collection("outboxEvents").where("householdId", "==", "replay").get()).size).toBe(1);
  });
});
