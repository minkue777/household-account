import { describe, expect, it } from "vitest";
import type {
  LogoutSessionResult,
  RestoreSessionResult,
  SessionEndpointRegistrationResult,
  SessionEndpointRemovalResult,
} from "../../../src/contexts/access/public";
import {
  createMembershipRetentionFixtureSubject,
  type MembershipRetentionSnapshot,
} from "../../support/session-membership-retention-fixture";

/**
 * Client Session Application의 공개 결과 계약입니다.
 * endpoint 결과는 Notifications가 확정한 typed 결과이며 호출 횟수는 관찰하지 않습니다.
 */
export interface MembershipRetentionSubject {
  supportedAccessCommands(): readonly string[];
  logoutHouseholdSession(
    endpointOutcome: SessionEndpointRemovalResult,
  ): Promise<LogoutSessionResult>;
  restoreSignedInSession(
    principalUid: string,
    endpointOutcome: SessionEndpointRegistrationResult,
  ): Promise<RestoreSessionResult>;
  setHouseholdStateForTest(state: "active" | "deleted"): void;
  deliverLateSessionCallback(generation: number, displayName: string): void;
  snapshot(): Promise<MembershipRetentionSnapshot>;
  publishedEvents(): Promise<readonly { eventType: string }[]>;
}

export function createSubject(): MembershipRetentionSubject {
  return createMembershipRetentionFixtureSubject();
}

describe("로그아웃·재로그인과 Membership 보존 공개 계약", () => {
  it("[T-HH-005][HH-004/HH-010] endpoint 제거가 끝난 뒤에만 로컬·Bridge 세션을 지우고 Membership과 Member는 보존한다", async () => {
    const subject = createSubject();

    const result = await subject.logoutHouseholdSession({ kind: "removed" });

    expect(result).toEqual({ kind: "logged-out", endpoint: "removed" });
    const state = await subject.snapshot();
    expect(state.session).toBeUndefined();
    expect(state.bridgeMirror).toBeUndefined();
    expect(state.notificationSync).toBe("not-requested");
    expect(state.member).toEqual({
      memberId: "member-min",
      displayName: "민규",
      status: "active",
    });
    expect(state.membership).toEqual({
      principalUid: "uid-min",
      householdId: "house-1",
      memberId: "member-min",
      status: "active",
    });
    expect(await subject.publishedEvents()).toEqual([]);
  });

  it("[T-HH-005][HH-004] endpoint가 이미 없으면 멱등 로그아웃하고 일시 실패면 세션 전체를 유지한다", async () => {
    const alreadyAbsent = createSubject();
    await expect(
      alreadyAbsent.logoutHouseholdSession({ kind: "already-absent" }),
    ).resolves.toEqual({
      kind: "logged-out",
      endpoint: "already-absent",
    });
    expect((await alreadyAbsent.snapshot()).session).toBeUndefined();

    const failing = createSubject();
    const before = await failing.snapshot();
    await expect(
      failing.logoutHouseholdSession({
        kind: "retryable-failure",
        code: "ENDPOINT_REMOVE_UNAVAILABLE",
      }),
    ).resolves.toEqual({
      kind: "retryable-failure",
      code: "ENDPOINT_REMOVE_UNAVAILABLE",
    });
    expect(await failing.snapshot()).toEqual(before);
    expect(await failing.publishedEvents()).toEqual([]);
  });

  it("[T-HH-005][HH-005/HH-010] 로그아웃 후 재로그인은 서버 Membership의 같은 memberId로 versioned 세션과 Bridge를 원자 복원한다", async () => {
    const subject = createSubject();
    await subject.logoutHouseholdSession({ kind: "removed" });

    const result = await subject.restoreSignedInSession("uid-min", {
      kind: "registered",
      endpointId: "endpoint-new-login",
    });

    expect(result).toEqual({
      kind: "restored",
      session: {
        schemaVersion: "session-scope.v1",
        sessionGeneration: 2,
        principalUid: "uid-min",
        householdId: "house-1",
        actingMemberId: "member-min",
        displayName: "민규",
      },
      notificationSync: {
        kind: "registered",
        endpointId: "endpoint-new-login",
      },
    });
    const state = await subject.snapshot();
    expect(state.session?.actingMemberId).toBe("member-min");
    expect(state.bridgeMirror).toEqual({
      householdId: "house-1",
      memberId: "member-min",
      sessionGeneration: 2,
    });
    expect(state.membership.memberId).toBe("member-min");
  });

  it("[T-HH-005][HH-005] endpoint 등록 실패는 로그인 성공과 분리되고 이전 generation의 늦은 callback은 새 세션을 덮지 않는다", async () => {
    const subject = createSubject();

    const result = await subject.restoreSignedInSession("uid-min", {
      kind: "retryable-failure",
      code: "ENDPOINT_REGISTER_UNAVAILABLE",
    });
    subject.deliverLateSessionCallback(1, "오래된 이름");

    expect(result).toEqual({
      kind: "restored",
      session: expect.objectContaining({
        sessionGeneration: 2,
        actingMemberId: "member-min",
      }),
      notificationSync: {
        kind: "retryable-failure",
        code: "ENDPOINT_REGISTER_UNAVAILABLE",
      },
    });
    const state = await subject.snapshot();
    expect(state.session).toEqual(
      expect.objectContaining({
        sessionGeneration: 2,
        displayName: "민규",
      }),
    );
    expect(state.notificationSync).toBe("retryable-failure");
    expect(state.session).not.toHaveProperty("partnerMemberId");
  });

  it("[T-HH-005][HH-010] 일반 사용자 공개 명령에는 탈퇴가 없고 논리 삭제·복구 뒤에도 같은 Membership으로 복원한다", async () => {
    const subject = createSubject();

    expect(subject.supportedAccessCommands()).not.toContain("LeaveHousehold");
    subject.setHouseholdStateForTest("deleted");
    await expect(
      subject.restoreSignedInSession("uid-min", {
        kind: "registered",
        endpointId: "endpoint-ignored",
      }),
    ).resolves.toEqual({
      kind: "conflict",
      code: "HOUSEHOLD_NOT_ACTIVE",
    });

    subject.setHouseholdStateForTest("active");
    const restored = await subject.restoreSignedInSession("uid-min", {
      kind: "registered",
      endpointId: "endpoint-after-household-restore",
    });

    expect(restored).toEqual(
      expect.objectContaining({
        kind: "restored",
        session: expect.objectContaining({ actingMemberId: "member-min" }),
      }),
    );
    const state = await subject.snapshot();
    expect(state.member.memberId).toBe("member-min");
    expect(state.membership.memberId).toBe("member-min");
    expect(await subject.publishedEvents()).toEqual([]);
  });
});
