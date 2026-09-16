import type * as firestore from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { FirebaseMemberRenameStore } from "../../../src/adapters/firebase/access/firebaseMemberRenameStore";
import { principalClaimId } from "../../../src/adapters/firebase/access/firebaseAccessPersistence";
import { createAdminMemberAccessHandlers } from "../../../src/bootstrap/admin/handlers/adminMemberAccessHandlers";
import { createAdminAccessRouter, type AdminAccessOperation } from "../../../src/bootstrap/admin/adminAccess";
import { verifiedSystemAdministrator } from "../../../src/bootstrap/verifiedSystemAdministrator";
import { createMemberRenameApplication } from "../../../src/contexts/access/member-rename/application/memberRenameApplication";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

describe("관리자 Member/Membership 독립 버전", () => {
  it("실제 이름 변경→관리 목록→제거→복구가 각자의 버전과 멱등 receipt를 보존한다", async () => {
    const memory = new InMemoryFirestore();
    const database = memory as unknown as firestore.Firestore;
    const householdId = "house-1";
    const memberId = "member-1";
    const principalUid = "principal-1";
    const requestedAt = "2026-09-17T00:00:00.000Z";
    memory.seed(`households/${householdId}`, { lifecycleState: "active", aggregateVersion: 1 });
    memory.seed(`households/${householdId}/members/${memberId}`, {
      linkedPrincipalUid: principalUid, displayName: "기존 이름", lifecycleState: "active", aggregateVersion: 4,
    });
    memory.seed(`households/${householdId}/memberships/${principalUid}`, {
      principalUid, householdId, memberId, lifecycleState: "active", aggregateVersion: 2,
    });
    memory.seed(`households/${householdId}/assetOwnerProfiles/profile-1`, {
      householdId, profileId: "profile-1", linkedMemberId: memberId, displayName: "기존 이름",
      profileType: "member", lifecycleState: "active", aggregateVersion: 7,
    });
    memory.seed(`users/${principalUid}/householdMembershipViews/${householdId}`, {
      householdId, memberId, displayName: "기존 이름", lifecycleState: "active", aggregateVersion: 2, memberAggregateVersion: 4,
    });
    memory.seed(`principalMembershipClaims/${principalClaimId(principalUid)}`, { principalUid, householdId, memberId });
    memory.seed(`households/${householdId}/ledgerTransactions/history`, { householdId, memberId, amount: 100 });

    const rename = createMemberRenameApplication({ store: new FirebaseMemberRenameStore(
      database, householdId, requestedAt, "rename-command", { principalUid, memberId, idempotencyKey: "rename" },
    ) });
    expect(await rename.renameSelf(
      { principalUid, householdId, actingMemberId: memberId },
      { displayName: "새 이름", expectedVersion: 4, idempotencyKey: "rename" },
    )).toMatchObject({ kind: "success", member: { aggregateVersion: 5 } });

    const router = createAdminAccessRouter({ handlers: new Map(createAdminMemberAccessHandlers(database)) });
    const execute = (operation: AdminAccessOperation, payload: Record<string, unknown>, key: string) => router.execute({
      principalUid: "admin", administrator: verifiedSystemAdministrator("admin", { systemAdmin: true }), requestedAt,
      request: { contractVersion: "admin-access.v1", operation, payload, requestId: key, idempotencyKey: key },
    });
    const list = await execute("list-household-members", { householdId }, "list-before");
    expect(list).toMatchObject({ kind: "success", data: { members: [{ memberId, displayName: "새 이름", aggregateVersion: 2 }] } });
    if (list.kind !== "success") throw new Error("관리 목록 조회 실패");
    const version = (list.data as { members: { aggregateVersion: number }[] }).members[0].aggregateVersion;
    const removed = await execute("remove-household-member", { householdId, memberId, reason: "운영 확인", expectedVersion: version }, "remove");
    expect(removed).toMatchObject({ kind: "success", data: { membershipVersion: 3 } });
    expect(await execute("remove-household-member", { householdId, memberId, reason: "운영 확인", expectedVersion: version }, "remove")).toEqual(removed);
    expect(memory.document(`households/${householdId}/members/${memberId}`)).toMatchObject({ lifecycleState: "removed", aggregateVersion: 6 });
    expect(memory.document(`households/${householdId}/memberships/${principalUid}`)).toMatchObject({ lifecycleState: "removed", aggregateVersion: 3 });
    expect(memory.document(`principalMembershipClaims/${principalClaimId(principalUid)}`)).toBeUndefined();
    expect(memory.document(`users/${principalUid}/householdMembershipViews/${householdId}`)).toBeUndefined();
    expect(await execute("list-household-members", { householdId }, "list-removed")).toMatchObject({ kind: "success", data: { members: [{ lifecycleState: "removed", aggregateVersion: 3 }] } });

    expect(await execute("restore-household-member", { householdId, memberId, expectedVersion: 2 }, "stale-restore")).toMatchObject({ kind: "error", code: "VERSION_MISMATCH" });
    const restored = await execute("restore-household-member", { householdId, memberId, expectedVersion: 3 }, "restore");
    expect(restored).toMatchObject({ kind: "success", data: { membershipVersion: 4 } });
    expect(await execute("restore-household-member", { householdId, memberId, expectedVersion: 3 }, "restore")).toEqual(restored);
    expect(memory.document(`households/${householdId}/members/${memberId}`)).toMatchObject({ displayName: "새 이름", aggregateVersion: 7 });
    expect(memory.document(`households/${householdId}/memberships/${principalUid}`)).toMatchObject({ aggregateVersion: 4 });
    expect(memory.document(`users/${principalUid}/householdMembershipViews/${householdId}`)).toMatchObject({ displayName: "새 이름", aggregateVersion: 4, memberAggregateVersion: 7 });
    expect(memory.document(`households/${householdId}/assetOwnerProfiles/profile-1`)).toMatchObject({ lifecycleState: "active", aggregateVersion: 9 });
    expect(memory.document(`households/${householdId}/ledgerTransactions/history`)).toEqual({ householdId, memberId, amount: 100 });
    const events = memory.documentsInCollection("outboxEvents").map(({ value }) => value);
    expect(events.filter(event => event.eventType === "HouseholdMemberRemoved")).toHaveLength(1);
    expect(events.filter(event => event.eventType === "HouseholdMemberRestored")).toHaveLength(1);
    expect(events.find(event => event.eventType === "HouseholdMemberRestored")).toMatchObject({ aggregateVersion: 4, payload: { membershipVersion: 4 } });
  });
});
