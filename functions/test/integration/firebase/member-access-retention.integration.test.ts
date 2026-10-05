import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FirebaseMemberAccessStore } from "../../../src/adapters/firebase/operations/firebaseMemberAccessStore";

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeWithEmulator("[ADM-006][T-ADM-005] 접속 통계 실제 저장의 보존 기간", () => {
  const app = initializeApp({ projectId: "demo-member-access-retention" }, "member-access-retention");
  const db = getFirestore(app);
  const store = new FirebaseMemberAccessStore(db);
  beforeAll(() => db.recursiveDelete(db.collection("operations")));
  afterAll(() => deleteApp(app));

  it("30일 밖의 일별 키를 실제 문서에서 제거하고 누적 값·최초 생성 시각·영구 중복 방지를 보존한다", async () => {
    const event = { householdId: "house", memberId: "member", visitId: "old", platform: "ios-pwa" as const, accessedAt: "2026-09-01T01:00:00.000Z" };
    await store.record(event);
    const reference = (await db.collection("operations/runtime/memberAccessStats").get()).docs[0].ref;
    const createdAt = (await reference.get()).get("createdAt");
    await store.record({ ...event, visitId: "recent", platform: "android", accessedAt: "2026-10-04T01:00:00.000Z" });
    const current = { ...event, visitId: "now", accessedAt: "2026-10-05T01:00:00.000Z" };
    expect(await store.record(current)).toEqual({ kind: "recorded", totalAccessCount: 3 });
    const saved = (await reference.get()).data();
    expect(saved).toMatchObject({ totalAccessCount: 3, platformCounts: { android: 1, "ios-pwa": 2, web: 0 }, createdAt });
    expect(saved?.dailyAccessCounts).toEqual({ "2026-10-04": 1, "2026-10-05": 1 });
    // 최근 ID 목록에서 빠져도 영구 receipt가 재가산을 막습니다.
    await reference.update({ recentVisitIds: [] });
    expect(await store.record(event)).toEqual({ kind: "already-recorded", totalAccessCount: 3 });
    expect((await reference.get()).get("dailyAccessCounts")).toEqual(saved?.dailyAccessCounts);
    expect((await db.collection("operations/runtime/memberAccessVisits").get()).size).toBe(3);
  });
});

