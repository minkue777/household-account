import type * as firestore from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";

import { principalClaimId } from "../../../src/adapters/firebase/access/firebasePrincipalMembershipClaim";
import {
  FirebaseCaptureMembershipResolver,
} from "../../../src/adapters/firebase/payment-capture/firebaseCaptureMembershipResolver";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

const nativeToken = {
  hcaClient: "native", hcaCaptureMembershipVersion: 1, hcaCaptureMember: true,
  hcaCaptureHouseholdId: "house-1", hcaCaptureMemberId: "member-1",
};
const forbidden = { kind: "forbidden", code: "ACTIVE_HOUSEHOLD_MEMBERSHIP_REQUIRED" };

describe("Firebase capture membership resolver", () => {
  it.each([
    { name: "일반 Auth JWT", token: undefined },
    { name: "Native JWT", token: nativeToken },
  ])("$name도 같은 warm resolver에서 권위 active·removed·claim 삭제·복원을 매번 반영한다", async ({ token }) => {
    const memory = new InMemoryFirestore();
    const principalUid = "uid-1";
    const path = `principalMembershipClaims/${principalClaimId(principalUid)}`;
    const claim = { principalUid, householdId: "house-1", memberId: "member-1", lifecycleState: "active" };
    memory.seed(path, claim);
    const collection = vi.spyOn(memory, "collection");
    const resolver = new FirebaseCaptureMembershipResolver(memory as unknown as firestore.Firestore);
    await expect(resolver.resolve(principalUid, token)).resolves.toMatchObject({ kind: "active", householdId: "house-1" });
    expect(collection).toHaveBeenCalledExactlyOnceWith("principalMembershipClaims");

    memory.seed(path, { ...claim, lifecycleState: "removed" });
    await expect(resolver.resolve(principalUid, token)).resolves.toEqual(forbidden);
    memory.remove(path);
    await expect(resolver.resolve(principalUid, token)).resolves.toEqual(forbidden);
    memory.seed(path, claim);
    await expect(resolver.resolve(principalUid, token)).resolves.toMatchObject({ kind: "active", householdId: "house-1" });
    memory.seed(path, { ...claim, householdLifecycleState: "deleted" });
    await expect(resolver.resolve(principalUid, token)).resolves.toEqual(forbidden);
  });

  it.each([
    { householdId: "new-house", memberId: "member-1" },
    { householdId: "house-1", memberId: "new-member" },
  ])("Native 발급 신원과 달라진 현재 권위를 과거 알림의 새 scope로 재해석하지 않는다: %j", async scope => {
    const memory = new InMemoryFirestore();
    const principalUid = "uid-1";
    memory.seed(`principalMembershipClaims/${principalClaimId(principalUid)}`, { principalUid, ...scope, lifecycleState: "active" });
    const resolver = new FirebaseCaptureMembershipResolver(memory as unknown as firestore.Firestore);
    await expect(resolver.resolve(principalUid, nativeToken)).resolves.toEqual(forbidden);
    await expect(resolver.resolve(principalUid, { ...nativeToken, hcaCaptureHouseholdId: scope.householdId, hcaCaptureMemberId: scope.memberId })).resolves.toMatchObject({ kind: "active", ...scope });
  });

  it("권위 조회 실패를 이전 Native claim으로 성공 처리하지 않는다", async () => {
    const memory = new InMemoryFirestore();
    vi.spyOn(memory, "collection").mockImplementation(() => { throw new Error("authority unavailable"); });
    await expect(new FirebaseCaptureMembershipResolver(memory as unknown as firestore.Firestore).resolve("uid-1", nativeToken)).rejects.toThrow("authority unavailable");
  });

  it("전역 claim 없는 전환 데이터도 canonical 상태와 Native 신원 일치를 확인한다", async () => {
    const memory = new InMemoryFirestore();
    memory.seed("users/uid-1/householdMembershipViews/house-1", { householdId: "house-1", memberId: "member-1", lifecycleState: "active" });
    memory.seed("households/house-1", { lifecycleState: "active" });
    memory.seed("households/house-1/memberships/uid-1", { memberId: "member-1", lifecycleState: "active" });
    memory.seed("households/house-1/members/member-1", { lifecycleState: "active" });
    const resolver = new FirebaseCaptureMembershipResolver(memory as unknown as firestore.Firestore);
    await expect(resolver.resolve("uid-1", nativeToken)).resolves.toMatchObject({ kind: "active" });
    await expect(resolver.resolve("uid-1", { ...nativeToken, hcaCaptureHouseholdId: "old-house" })).resolves.toEqual(forbidden);
    memory.seed("households/house-1/memberships/uid-1", { memberId: "member-1", lifecycleState: "removed" });
    await expect(resolver.resolve("uid-1", nativeToken)).resolves.toEqual(forbidden);
  });

  it("마이그레이션된 사용자는 전역 claim 한 문서로 수집 권한을 해석한다", async () => {
    const memory = new InMemoryFirestore();
    const principalUid = "uid-1";
    memory.seed(
      `principalMembershipClaims/${principalClaimId(principalUid)}`,
      {
        principalUid,
        householdId: "house-1",
        memberId: "member-1",
        lifecycleState: "active",
      },
    );

    await expect(
      new FirebaseCaptureMembershipResolver(
        memory as unknown as firestore.Firestore,
      ).resolve(principalUid),
    ).resolves.toEqual({
      kind: "active",
      principalUid,
      householdId: "house-1",
      memberId: "member-1",
    });
    expect(memory.paths()).toEqual([
      `principalMembershipClaims/${principalClaimId(principalUid)}`,
    ]);
  });

  it("가구 삭제 상태가 claim에 투영되면 수집을 거부한다", async () => {
    const memory = new InMemoryFirestore();
    const principalUid = "uid-deleted-household";
    memory.seed(
      `principalMembershipClaims/${principalClaimId(principalUid)}`,
      {
        principalUid,
        householdId: "house-deleted",
        memberId: "member-1",
        lifecycleState: "active",
        householdLifecycleState: "deleted",
      },
    );

    await expect(
      new FirebaseCaptureMembershipResolver(
        memory as unknown as firestore.Firestore,
      ).resolve(principalUid),
    ).resolves.toEqual({
      kind: "forbidden",
      code: "ACTIVE_HOUSEHOLD_MEMBERSHIP_REQUIRED",
    });
  });

  it("전역 claim이 존재하지만 비활성이면 이전 view로 우회하지 않는다", async () => {
    const memory = new InMemoryFirestore();
    const principalUid = "uid-1";
    memory.seed(
      `principalMembershipClaims/${principalClaimId(principalUid)}`,
      {
        principalUid,
        householdId: "house-1",
        memberId: "member-1",
        lifecycleState: "removed",
      },
    );
    memory.seed(
      `users/${principalUid}/householdMembershipViews/house-1`,
      {
        principalUid,
        householdId: "house-1",
        memberId: "member-1",
        lifecycleState: "active",
      },
    );

    await expect(
      new FirebaseCaptureMembershipResolver(
        memory as unknown as firestore.Firestore,
      ).resolve(principalUid),
    ).resolves.toEqual({
      kind: "forbidden",
      code: "ACTIVE_HOUSEHOLD_MEMBERSHIP_REQUIRED",
    });
  });
});
