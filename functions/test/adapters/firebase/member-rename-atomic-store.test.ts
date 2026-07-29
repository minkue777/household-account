import type * as firestore from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { FirebaseMemberRenameStore } from "../../../src/adapters/firebase/access/firebaseMemberRenameStore";
import { createMemberRenameApplication } from "../../../src/contexts/access/member-rename/application/memberRenameApplication";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

describe("Firebase member rename atomic adapter", () => {
  it("멤버·자산 명의자·로그인 Membership 표시 이름을 한 트랜잭션에서 갱신한다", async () => {
    const memory = new InMemoryFirestore();
    memory.seed("households/house-1", {
      lifecycleState: "active",
      aggregateVersion: 1,
    });
    memory.seed("households/house-1/members/member-jang", {
      householdId: "house-1",
      memberId: "member-jang",
      linkedPrincipalUid: "principal-jang",
      displayName: "김장휘",
      aggregateVersion: 1,
      lifecycleState: "active",
    });
    memory.seed("households/house-1/memberships/principal-jang", {
      householdId: "house-1",
      memberId: "member-jang",
      lifecycleState: "active",
    });
    memory.seed("households/house-1/assetOwnerProfiles/profile-jang", {
      householdId: "house-1",
      profileId: "profile-jang",
      linkedMemberId: "member-jang",
      displayName: "김장휘",
      lifecycleState: "active",
    });
    memory.seed(
      "users/principal-jang/householdMembershipViews/house-1",
      {
        householdId: "house-1",
        memberId: "member-jang",
        displayName: "김장휘",
        memberAggregateVersion: 1,
        lifecycleState: "active",
      },
    );

    const application = createMemberRenameApplication({
      store: new FirebaseMemberRenameStore(
        memory as unknown as firestore.Firestore,
        "house-1",
        "2026-07-29T14:20:00.000Z",
        "rename-jang-command",
      ),
    });

    expect(
      await application.renameSelf(
        {
          principalUid: "principal-jang",
          householdId: "house-1",
          actingMemberId: "member-jang",
        },
        {
          displayName: "장휘",
          expectedVersion: 1,
          idempotencyKey: "rename-jang-v1",
        },
      ),
    ).toEqual({
      kind: "success",
      member: {
        memberId: "member-jang",
        displayName: "장휘",
        aggregateVersion: 2,
      },
    });

    expect(
      memory.document("households/house-1/members/member-jang"),
    ).toMatchObject({
      displayName: "장휘",
      aggregateVersion: 2,
    });
    expect(
      memory.document("households/house-1/assetOwnerProfiles/profile-jang"),
    ).toMatchObject({
      displayName: "장휘",
    });
    expect(
      memory.document(
        "users/principal-jang/householdMembershipViews/house-1",
      ),
    ).toMatchObject({
      displayName: "장휘",
      memberAggregateVersion: 2,
    });
  });
});
