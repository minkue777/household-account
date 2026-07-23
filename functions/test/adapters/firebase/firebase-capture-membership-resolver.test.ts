import type * as firestore from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { principalClaimId } from "../../../src/adapters/firebase/access/firebasePrincipalMembershipClaim";
import {
  FirebaseCaptureMembershipResolver,
} from "../../../src/adapters/firebase/payment-capture/firebaseCaptureMembershipResolver";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

describe("Firebase capture membership resolver", () => {
  it("서버가 발급한 Native membership claim은 Firestore 조회 없이 즉시 사용한다", async () => {
    let firestoreAccesses = 0;
    const database = {
      collection: () => {
        firestoreAccesses += 1;
        throw new Error("token fast path는 Firestore에 접근하면 안 됩니다.");
      },
    } as unknown as firestore.Firestore;

    await expect(
      new FirebaseCaptureMembershipResolver(database).resolve("uid-native", {
        hcaClient: "native",
        hcaCaptureMembershipVersion: 1,
        hcaCaptureMember: true,
        hcaCaptureHouseholdId: "house-native",
        hcaCaptureMemberId: "member-native",
      }),
    ).resolves.toEqual({
      kind: "active",
      principalUid: "uid-native",
      householdId: "house-native",
      memberId: "member-native",
    });
    expect(firestoreAccesses).toBe(0);
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
