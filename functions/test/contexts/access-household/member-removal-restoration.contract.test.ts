import { describe, expect, it } from "vitest";
import type {
  HouseholdMemberAdminActor,
  MemberLifecycleInputPort,
} from "../../../src/contexts/access/public";
import {
  createMemberRemovalRestorationFixtureSubject,
  type JoinOtherHouseholdResult,
  type MemberLifecycleFixtureKind,
  type MemberRemovalSnapshot,
} from "../../support/member-removal-restoration-fixture";

/**
 * Access의 관리자 Member 제거·복구 경계입니다.
 * Notifications endpoint와 타 Context 데이터는 최종 지문으로만 관찰합니다.
 */
export interface MemberRemovalRestorationSubject extends MemberLifecycleInputPort {
  joinAnotherHousehold(
    principalUid: string,
    householdId: string,
    idempotencyKey: string,
  ): Promise<JoinOtherHouseholdResult>;
  authorizeMember(memberId: string): Promise<"allowed" | "forbidden">;
  snapshot(): Promise<MemberRemovalSnapshot>;
  publishedEvents(): ReturnType<
    ReturnType<typeof createMemberRemovalRestorationFixtureSubject>["publishedEvents"]
  >;
}

export function createSubject(
  fixture: MemberLifecycleFixtureKind = "two-members",
): MemberRemovalRestorationSubject {
  return createMemberRemovalRestorationFixtureSubject(fixture);
}

const administrator: HouseholdMemberAdminActor = {
  principalRef: "verified-global-admin",
  capabilities: [
    "admin.household-members.remove",
    "admin.household-members.restore",
  ],
};

const ordinaryMember: HouseholdMemberAdminActor = {
  principalRef: "uid-household-member",
  capabilities: [],
};

const removeInput = (memberId: string, idempotencyKey: string) => ({
  householdId: "house-1",
  memberId,
  reason: "관리자 확인 제거",
  expectedMembershipVersion: 3,
  idempotencyKey,
});

describe("관리자 가구원 제거·복구 공개 계약", () => {
  it.each(["member-creator", "member-invitee"])(
    "[T-HH-007][HH-012/DEC-038/DEC-039] 일반 사용자는 %s 제거를 요청해도 어떤 상태도 바꾸지 못한다",
    async (memberId) => {
      const subject = createSubject();
      const before = await subject.snapshot();

      const result = await subject.removeHouseholdMember(
        ordinaryMember,
        removeInput(memberId, `ordinary-remove-${memberId}`),
      );

      expect(result).toEqual({
        kind: "forbidden",
        code: "ADMIN_MEMBER_REMOVE_REQUIRED",
      });
      expect(await subject.snapshot()).toEqual(before);
      expect(await subject.publishedEvents()).toEqual([]);
    },
  );

  it.each(["member-creator", "member-invitee"])(
    "[T-HH-007][HH-012/DEC-038/DEC-039] 관리자는 생성 경로와 무관하게 %s에 같은 제거 규칙을 적용한다",
    async (memberId) => {
      const subject = createSubject();
      const before = await subject.snapshot();

      const result = await subject.removeHouseholdMember(
        administrator,
        removeInput(memberId, `admin-remove-${memberId}`),
      );

      expect(result).toEqual({
        kind: "success",
        memberId,
        membershipStatus: "removed",
        membershipVersion: 4,
      });
      const after = await subject.snapshot();
      expect(after.household.lifecycleState).toBe("active");
      expect(after.businessDataDigest).toEqual(before.businessDataDigest);
      expect(after.notificationEndpointIds).toEqual(
        before.notificationEndpointIds,
      );
      expect(after.members).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ memberId, status: "removed" }),
        ]),
      );
      expect(after.memberOwnerProfiles).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            linkedMemberId: memberId,
            lifecycleState: "archived",
          }),
        ]),
      );
      expect(
        after.principalClaims.some((claim) => claim.memberId === memberId),
      ).toBe(false);
      expect(after.activeRecipientMemberIds).not.toContain(memberId);
      await expect(subject.authorizeMember(memberId)).resolves.toBe("forbidden");
      expect(await subject.publishedEvents()).toEqual([
        {
          eventType: "HouseholdMemberRemoved.v1",
          householdId: "house-1",
          memberId,
          membershipVersion: 4,
        },
      ]);
    },
  );

  it("[T-HH-007][HH-012] 마지막 활성 Member 제거도 빈 active Household와 기존 업무 기록을 보존한다", async () => {
    const subject = createSubject("last-member");
    const before = await subject.snapshot();

    await subject.removeHouseholdMember(
      administrator,
      removeInput("member-last", "remove-last-member"),
    );

    const after = await subject.snapshot();
    expect(after.household).toEqual({
      householdId: "house-1",
      lifecycleState: "active",
    });
    expect(after.members.filter(({ status }) => status === "active")).toHaveLength(0);
    expect(after.principalClaims).toHaveLength(0);
    expect(after.businessDataDigest).toEqual(before.businessDataDigest);
    expect(after.businessDataDigest).not.toEqual({});
  });

  it("[T-HH-007][HH-012] 복구는 같은 Member·Membership·명의자 profile ID를 재활성화하지만 과거 endpoint를 만들지 않는다", async () => {
    const subject = createSubject("removed-member");
    const before = await subject.snapshot();

    const result = await subject.restoreRemovedHouseholdMember(administrator, {
      householdId: "house-1",
      memberId: "member-removed",
      expectedMembershipVersion: 4,
      idempotencyKey: "restore-removed-member",
    });

    expect(result).toEqual({
      kind: "success",
      memberId: "member-removed",
      membershipStatus: "active",
      membershipVersion: 5,
    });
    const after = await subject.snapshot();
    expect(after.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ memberId: "member-removed", status: "active" }),
      ]),
    );
    expect(after.memberships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          principalUid: "uid-removed",
          householdId: "house-1",
          memberId: "member-removed",
          status: "active",
          version: 5,
        }),
      ]),
    );
    expect(after.memberOwnerProfiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profileId: "profile-member-removed",
          linkedMemberId: "member-removed",
          lifecycleState: "active",
        }),
      ]),
    );
    expect(after.notificationEndpointIds).toEqual(
      before.notificationEndpointIds,
    );
    expect(after.notificationEndpointIds).toHaveLength(0);
    expect(after.principalClaims).toEqual(
      expect.arrayContaining([
        {
          principalUid: "uid-removed",
          householdId: "house-1",
          memberId: "member-removed",
        },
      ]),
    );
    expect(after.activeRecipientMemberIds).toContain("member-removed");
    expect(after.businessDataDigest).toEqual(before.businessDataDigest);
    await expect(subject.authorizeMember("member-removed")).resolves.toBe(
      "allowed",
    );
    expect(await subject.publishedEvents()).toEqual([
      {
        eventType: "HouseholdMemberRestored.v1",
        householdId: "house-1",
        memberId: "member-removed",
        membershipVersion: 5,
      },
    ]);
  });

  it("[T-HH-007][HH-012/DEC-038] 일반 사용자는 removed Member 복구를 호출해도 claim·Membership을 바꾸지 못한다", async () => {
    const subject = createSubject("removed-member");
    const before = await subject.snapshot();

    await expect(
      subject.restoreRemovedHouseholdMember(ordinaryMember, {
        householdId: "house-1",
        memberId: "member-removed",
        expectedMembershipVersion: 4,
        idempotencyKey: "ordinary-restore-forbidden",
      }),
    ).resolves.toEqual({
      kind: "forbidden",
      code: expect.any(String),
    });
    expect(await subject.snapshot()).toEqual(before);
    expect(await subject.publishedEvents()).toEqual([]);
  });

  it("[T-HH-007][HH-012] stale expectedVersion 복구는 기존 removed 상태와 UID claim 부재를 보존한다", async () => {
    const subject = createSubject("removed-member");
    const before = await subject.snapshot();

    await expect(
      subject.restoreRemovedHouseholdMember(administrator, {
        householdId: "house-1",
        memberId: "member-removed",
        expectedMembershipVersion: 3,
        idempotencyKey: "stale-restore-version",
      }),
    ).resolves.toEqual({
      kind: "conflict",
      code: expect.any(String),
    });
    expect(await subject.snapshot()).toEqual(before);
    expect(await subject.publishedEvents()).toEqual([]);
  });

  it("[T-HH-007][HH-012/DEC-038] 제거 뒤 UID가 다른 가구에 가입했다면 복구는 claim을 덮어쓰지 않고 충돌한다", async () => {
    const subject = createSubject("removed-member");
    await expect(
      subject.joinAnotherHousehold(
        "uid-removed",
        "house-2",
        "join-after-removal",
      ),
    ).resolves.toEqual({
      kind: "success",
      householdId: "house-2",
      memberId: expect.any(String),
    });
    const beforeRestore = await subject.snapshot();

    const result = await subject.restoreRemovedHouseholdMember(administrator, {
      householdId: "house-1",
      memberId: "member-removed",
      expectedMembershipVersion: 4,
      idempotencyKey: "restore-after-other-join",
    });

    expect(result).toEqual({
      kind: "conflict",
      code: "PRINCIPAL_ALREADY_JOINED",
    });
    expect(await subject.snapshot()).toEqual(beforeRestore);
    expect(await subject.publishedEvents()).toEqual([]);
  });

  it("[T-HH-007][HH-012/DEC-038] removed UID의 복구와 다른 가구 가입이 경합하면 전역 claim 하나만 성공한다", async () => {
    const subject = createSubject("removed-member");

    const [restored, joined] = await Promise.all([
      subject.restoreRemovedHouseholdMember(administrator, {
        householdId: "house-1",
        memberId: "member-removed",
        expectedMembershipVersion: 4,
        idempotencyKey: "concurrent-restore",
      }),
      subject.joinAnotherHousehold(
        "uid-removed",
        "house-2",
        "concurrent-other-join",
      ),
    ]);

    expect(
      [restored, joined].filter(({ kind }) => kind === "success"),
    ).toHaveLength(1);
    expect(
      [restored, joined].filter(({ kind }) => kind === "conflict"),
    ).toHaveLength(1);
    const state = await subject.snapshot();
    expect(
      state.principalClaims.filter(
        ({ principalUid }) => principalUid === "uid-removed",
      ),
    ).toHaveLength(1);
    const claim = state.principalClaims.find(
      ({ principalUid }) => principalUid === "uid-removed",
    );
    expect(claim?.householdId === "house-1" || claim?.householdId === "house-2").toBe(
      true,
    );
  });

  it("[T-HH-007][HH-012] 같은 제거 명령 재전달은 결과를 재생하고 제거 Event를 중복 발행하지 않는다", async () => {
    const subject = createSubject();
    const input = removeInput("member-invitee", "same-remove-command");

    const first = await subject.removeHouseholdMember(administrator, input);
    const replay = await subject.removeHouseholdMember(administrator, input);

    expect(replay).toEqual(first);
    expect(await subject.publishedEvents()).toHaveLength(1);
  });

  it("[T-HH-007][HH-012] 같은 복구 명령 재전달도 결과를 재생하고 복구 Event를 중복 발행하지 않는다", async () => {
    const subject = createSubject("removed-member");
    const input = {
      householdId: "house-1",
      memberId: "member-removed",
      expectedMembershipVersion: 4,
      idempotencyKey: "same-restore-command",
    };

    const first = await subject.restoreRemovedHouseholdMember(administrator, input);
    const replay = await subject.restoreRemovedHouseholdMember(administrator, input);

    expect(replay).toEqual(first);
    expect(await subject.publishedEvents()).toHaveLength(1);
  });

  it("[T-HH-007][HH-012] 같은 멱등 키의 다른 제거 payload는 최초 제거를 보존하고 충돌한다", async () => {
    const subject = createSubject();
    await subject.removeHouseholdMember(
      administrator,
      removeInput("member-invitee", "remove-payload-conflict"),
    );
    const afterFirst = await subject.snapshot();

    const conflict = await subject.removeHouseholdMember(administrator, {
      ...removeInput("member-invitee", "remove-payload-conflict"),
      reason: "다른 제거 사유",
      expectedMembershipVersion: 4,
    });

    expect(conflict).toEqual({
      kind: "conflict",
      code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
    });
    expect(await subject.snapshot()).toEqual(afterFirst);
    expect(await subject.publishedEvents()).toHaveLength(1);
  });

  it("[T-HH-007][HH-012] 이미 removed인 Member의 새 제거 명령은 멱등 완료로 처리하고 Event를 만들지 않는다", async () => {
    const subject = createSubject("removed-member");
    const before = await subject.snapshot();

    const result = await subject.removeHouseholdMember(administrator, {
      householdId: "house-1",
      memberId: "member-removed",
      reason: "이미 제거된 대상 확인",
      expectedMembershipVersion: 4,
      idempotencyKey: "fresh-remove-already-removed",
    });

    expect(result).toEqual({
      kind: "already-processed",
      memberId: "member-removed",
      membershipVersion: 4,
    });
    expect(await subject.snapshot()).toEqual(before);
    expect(await subject.publishedEvents()).toEqual([]);
  });
});
