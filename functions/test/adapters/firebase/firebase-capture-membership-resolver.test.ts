import type * as firestore from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { principalClaimId } from "../../../src/adapters/firebase/access/firebasePrincipalMembershipClaim";
import { FirebaseCaptureMembershipResolver } from "../../../src/adapters/firebase/payment-capture/firebaseCaptureMembershipResolver";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

describe("Firebase capture membership resolver", () => {
  it("마이그레이션된 사용자는 전역 claim과 가구 상태 두 문서로 수집 권한을 해석한다", async () => {
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
    memory.seed("households/house-1", { lifecycleState: "active" });

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
      "households/house-1",
      `principalMembershipClaims/${principalClaimId(principalUid)}`,
    ]);
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
