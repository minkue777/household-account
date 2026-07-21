import { describe, expect, it } from "vitest";
import type {
  LegacyMembershipMigrationInputPort,
  LegacyMembershipView,
  LegacySessionCandidate,
} from "../../../src/contexts/access/public";
import {
  createLegacyMembershipMigrationFixtureSubject,
  type LegacyMigrationFixture,
  type LegacyMigrationSnapshot,
} from "../../support/legacy-membership-migration-fixture";

/**
 * Web legacy 후보 캡처와 Access의 일회 Membership claim을 함께 검증합니다.
 * fixture와 snapshot은 테스트 driver이며 localStorage/DB 물리 경로를 계약화하지 않습니다.
 */
export interface LegacyMembershipMigrationSubject
  extends LegacyMembershipMigrationInputPort {
  snapshot(): Promise<LegacyMigrationSnapshot>;
}

export function createSubject(
  fixture: LegacyMigrationFixture,
): LegacyMembershipMigrationSubject {
  return createLegacyMembershipMigrationFixtureSubject(fixture);
}

const legacyHousehold = {
  householdId: "household-existing",
  legacyHouseholdKey: "old-household-key",
  lifecycleState: "active" as const,
};

const legacyMember = {
  householdId: legacyHousehold.householdId,
  memberId: "member-existing",
  displayName: "민규",
};

const completeStorage = {
  householdKey: legacyHousehold.legacyHouseholdKey,
  currentMemberId: legacyMember.memberId,
  currentMemberName: legacyMember.displayName,
  unrelatedPreference: "keep-me",
};

const fixture = (
  overrides: Partial<LegacyMigrationFixture> = {},
): LegacyMigrationFixture => ({
  webLocalStorage: completeStorage,
  households: [legacyHousehold],
  members: [legacyMember],
  memberships: [],
  businessDataDigest: "finance-and-portfolio-data-v1",
  repositoryAvailability: "available",
  ...overrides,
});

describe("legacy localStorage 일회 Membership 전환 공개 계약", () => {
  it("[T-HH-001/T-HH-002][HH-001] 서버 Membership 조회 일시 실패는 first visit으로 위장하지 않고 캡처한 legacy 후보를 보존한다", async () => {
    const subject = createSubject(
      fixture({ repositoryAvailability: "temporarily-unavailable" }),
    );
    const captured = subject.captureLegacySessionCandidate();

    expect(captured).toEqual({
      kind: "complete",
      candidate: {
        householdKey: legacyHousehold.legacyHouseholdKey,
        currentMemberId: legacyMember.memberId,
        currentMemberName: legacyMember.displayName,
      },
    });
    await expect(
      subject.resolveSignedInUser("google-migrating"),
    ).resolves.toEqual({
      kind: "retryable-failure",
      code: "MEMBERSHIP_LOOKUP_UNAVAILABLE",
    });
    expect((await subject.snapshot()).webLocalStorage).toEqual(completeStorage);
  });

  it.each<{
    label: string;
    webLocalStorage: Readonly<Record<string, string>>;
  }>([
    {
      label: "localStorage가 비어 있음",
      webLocalStorage: {},
    },
    {
      label: "householdKey만 있음",
      webLocalStorage: { householdKey: "old-household-key" },
    },
    {
      label: "currentMemberId만 있음",
      webLocalStorage: { currentMemberId: "member-existing" },
    },
  ])(
    "[T-HH-002][HH-001/HH-003] $label이면 후보를 추정하지 않고 신규 사용자로 분기한다",
    async ({ webLocalStorage }) => {
      const subject = createSubject(fixture({ webLocalStorage }));

      expect(subject.captureLegacySessionCandidate()).toEqual({ kind: "absent" });
      await expect(subject.resolveSignedInUser("google-new-user")).resolves.toEqual({
        kind: "first-visit-required",
        choices: ["create", "join"],
      });
    },
  );

  it("[T-HH-002][HH-001] Android Native 값만으로 기존 사용자를 추정하지 않는다", async () => {
    const subject = createSubject(
      fixture({
        webLocalStorage: {},
        androidNativeMirror: {
          householdKey: legacyHousehold.legacyHouseholdKey,
          currentMemberId: legacyMember.memberId,
          currentMemberName: legacyMember.displayName,
        },
      }),
    );

    expect(subject.captureLegacySessionCandidate()).toEqual({ kind: "absent" });
    await expect(subject.resolveSignedInUser("google-new-user")).resolves.toEqual({
      kind: "first-visit-required",
      choices: ["create", "join"],
    });
  });

  it("[T-HH-001][HH-001/DEC-034] 서버 Membership이 있으면 서로 다른 legacy 후보보다 항상 우선한다", async () => {
    const serverHousehold = {
      householdId: "household-server",
      legacyHouseholdKey: "server-household-key",
      lifecycleState: "active" as const,
    };
    const serverMembership: LegacyMembershipView = {
      householdId: serverHousehold.householdId,
      memberId: "member-server",
      principalUid: "google-returning-user",
      status: "active",
    };
    const subject = createSubject(
      fixture({
        households: [legacyHousehold, serverHousehold],
        members: [
          legacyMember,
          {
            householdId: serverHousehold.householdId,
            memberId: serverMembership.memberId,
            displayName: "서버 사용자",
            linkedPrincipalUid: serverMembership.principalUid,
          },
        ],
        memberships: [serverMembership],
      }),
    );

    expect(subject.captureLegacySessionCandidate().kind).toBe("complete");
    await expect(
      subject.resolveSignedInUser(serverMembership.principalUid),
    ).resolves.toEqual({
      kind: "membership-found",
      membership: serverMembership,
    });

    const state = await subject.snapshot();
    expect(
      state.memberships.filter(
        (membership) =>
          membership.principalUid === serverMembership.principalUid,
      ),
    ).toEqual([serverMembership]);
  });

  it("[T-HH-001][HH-001/HH-002] 확인한 완전 후보는 기존 householdId·memberId에 연결하고 기존 데이터를 복사하지 않는다", async () => {
    const subject = createSubject(fixture());
    const captured = subject.captureLegacySessionCandidate();
    expect(captured).toEqual({
      kind: "complete",
      candidate: {
        householdKey: legacyHousehold.legacyHouseholdKey,
        currentMemberId: legacyMember.memberId,
        currentMemberName: legacyMember.displayName,
      },
    });
    if (captured.kind !== "complete") {
      throw new Error("완전 후보가 필요합니다.");
    }

    await expect(subject.resolveSignedInUser("google-migrating")).resolves.toEqual({
      kind: "legacy-confirmation-required",
      candidate: captured.candidate,
    });

    const result = await subject.claimLegacySession({
      principalUid: "google-migrating",
      candidate: captured.candidate,
      userConfirmed: true,
      idempotencyKey: "legacy-claim-once",
    });

    expect(result).toEqual({
      kind: "membership-linked",
      membership: {
        householdId: legacyHousehold.householdId,
        memberId: legacyMember.memberId,
        principalUid: "google-migrating",
        status: "active",
      },
      session: {
        householdId: legacyHousehold.householdId,
        actingMemberId: legacyMember.memberId,
        principalUid: "google-migrating",
      },
    });
    if (result.kind !== "membership-linked") {
      throw new Error("legacy Membership 연결 성공 결과가 필요합니다.");
    }

    const state = await subject.snapshot();
    expect(state.businessDataDigest).toBe("finance-and-portfolio-data-v1");
    expect(state.members).toContainEqual({
      ...legacyMember,
      linkedPrincipalUid: "google-migrating",
    });
    expect(state.memberOwnerProfiles).toEqual([
      expect.objectContaining({
        householdId: legacyHousehold.householdId,
        linkedMemberId: legacyMember.memberId,
        lifecycleState: "active",
      }),
    ]);
    expect(state.currentSession).toEqual(result.session);
    expect(state.webLocalStorage).not.toHaveProperty("householdKey");
    expect(state.webLocalStorage).not.toHaveProperty("currentMemberId");
    expect(state.webLocalStorage).not.toHaveProperty("currentMemberName");
    expect(state.webLocalStorage).toHaveProperty("unrelatedPreference", "keep-me");
  });

  it("[T-HH-002][HH-002] 같은 UID·Member 재시도는 같은 Membership을 멱등 반환한다", async () => {
    const subject = createSubject(fixture());
    const captured = subject.captureLegacySessionCandidate();
    if (captured.kind !== "complete") {
      throw new Error("완전 후보가 필요합니다.");
    }

    const first = await subject.claimLegacySession({
      principalUid: "google-same-user",
      candidate: captured.candidate,
      userConfirmed: true,
      idempotencyKey: "legacy-first",
    });
    const retried = await subject.claimLegacySession({
      principalUid: "google-same-user",
      candidate: captured.candidate,
      userConfirmed: true,
      idempotencyKey: "legacy-retry-with-new-command",
    });

    expect(first.kind).toBe("membership-linked");
    expect(retried.kind).toBe("already-linked");
    if (
      (first.kind !== "membership-linked" && first.kind !== "already-linked") ||
      (retried.kind !== "membership-linked" && retried.kind !== "already-linked")
    ) {
      throw new Error("Membership 연결 결과가 필요합니다.");
    }
    expect(retried.membership).toEqual(first.membership);
    const state = await subject.snapshot();
    expect(
      state.memberships.filter(
        (membership) => membership.principalUid === "google-same-user",
      ),
    ).toHaveLength(1);
    expect(state.memberOwnerProfiles).toHaveLength(1);
  });

  it("[T-HH-002][HH-002] 다른 UID가 이미 연결한 Member는 덮어쓰지 않고 기존 데이터도 바꾸지 않는다", async () => {
    const subject = createSubject(fixture());
    const captured = subject.captureLegacySessionCandidate();
    if (captured.kind !== "complete") {
      throw new Error("완전 후보가 필요합니다.");
    }

    await subject.claimLegacySession({
      principalUid: "google-first-claimer",
      candidate: captured.candidate,
      userConfirmed: true,
      idempotencyKey: "legacy-first-claim",
    });
    const beforeConflict = await subject.snapshot();
    const conflict = await subject.claimLegacySession({
      principalUid: "google-second-claimer",
      candidate: captured.candidate,
      userConfirmed: true,
      idempotencyKey: "legacy-second-claim",
    });
    const afterConflict = await subject.snapshot();

    expect(conflict).toEqual({
      kind: "conflict",
      code: "MEMBER_ALREADY_LINKED",
    });
    expect(afterConflict.members).toEqual(beforeConflict.members);
    expect(afterConflict.memberships).toEqual(beforeConflict.memberships);
    expect(afterConflict.businessDataDigest).toBe(beforeConflict.businessDataDigest);
    expect(
      afterConflict.memberships.filter(
        (membership) => membership.principalUid === "google-second-claimer",
      ),
    ).toHaveLength(0);
  });

  it("[T-HH-002][HH-002] 서로 다른 UID가 같은 legacy Member를 동시에 claim하면 한 UID만 원자적으로 연결된다", async () => {
    const subject = createSubject(fixture());
    const candidate: LegacySessionCandidate = {
      householdKey: legacyHousehold.legacyHouseholdKey,
      currentMemberId: legacyMember.memberId,
      currentMemberName: legacyMember.displayName,
    };

    const results = await Promise.all([
      subject.claimLegacySession({
        principalUid: "google-racer-a",
        candidate,
        userConfirmed: true,
        idempotencyKey: "legacy-race-a",
      }),
      subject.claimLegacySession({
        principalUid: "google-racer-b",
        candidate,
        userConfirmed: true,
        idempotencyKey: "legacy-race-b",
      }),
    ]);

    expect(
      results.filter(({ kind }) => kind === "membership-linked"),
    ).toHaveLength(1);
    expect(results.filter(({ kind }) => kind === "conflict")).toHaveLength(1);
    const state = await subject.snapshot();
    expect(state.memberships).toHaveLength(1);
    expect(
      state.members.filter(
        ({ memberId, linkedPrincipalUid }) =>
          memberId === legacyMember.memberId && linkedPrincipalUid !== undefined,
      ),
    ).toHaveLength(1);
  });

  it("[T-HH-002][HH-002] 신원 확인을 마친 운영자만 정확한 UID·가구·Member claim을 교정하고 감사 기록을 남긴다", async () => {
    const subject = createSubject(fixture());
    const before = await subject.snapshot();

    await expect(
      subject.repairLegacyMembershipClaim(
        { principalRef: "ordinary-user", capabilities: [] },
        {
          principalUid: "google-recovered",
          householdId: legacyHousehold.householdId,
          memberId: legacyMember.memberId,
          reason: "본인 확인 완료",
          idempotencyKey: "operator-repair-forbidden",
        },
      ),
    ).resolves.toEqual({
      kind: "forbidden",
      code: "RECOVERY_CAPABILITY_REQUIRED",
    });
    expect(await subject.snapshot()).toEqual(before);

    const repaired = await subject.repairLegacyMembershipClaim(
      {
        principalRef: "verified-operator",
        capabilities: ["admin.membership-claims.repair"],
      },
      {
        principalUid: "google-recovered",
        householdId: legacyHousehold.householdId,
        memberId: legacyMember.memberId,
        reason: "본인 확인 완료",
        idempotencyKey: "operator-repair-approved",
      },
    );

    expect(repaired).toEqual({
      kind: "repaired",
      membership: {
        householdId: legacyHousehold.householdId,
        memberId: legacyMember.memberId,
        principalUid: "google-recovered",
        status: "active",
      },
    });
    const state = await subject.snapshot();
    expect(state.memberships).toEqual([
      expect.objectContaining({
        householdId: legacyHousehold.householdId,
        memberId: legacyMember.memberId,
        principalUid: "google-recovered",
      }),
    ]);
    expect(state.members).toContainEqual(
      expect.objectContaining({
        memberId: legacyMember.memberId,
        linkedPrincipalUid: "google-recovered",
      }),
    );
    expect(state.businessDataDigest).toBe(before.businessDataDigest);
    expect(state.auditEvents).toEqual([
      {
        eventType: "LegacyMembershipClaimRepaired.v1",
        householdId: legacyHousehold.householdId,
        memberId: legacyMember.memberId,
      },
    ]);
  });

  it("[T-HH-002][HH-002/DEC-034] UID에 다른 Membership이 있으면 legacy Member와 후보를 변경하지 않는다", async () => {
    const otherHousehold = {
      householdId: "household-other",
      legacyHouseholdKey: "other-household-key",
      lifecycleState: "active" as const,
    };
    const existingMembership: LegacyMembershipView = {
      householdId: otherHousehold.householdId,
      memberId: "member-other",
      principalUid: "google-already-joined",
      status: "active",
    };
    const subject = createSubject(
      fixture({
        households: [legacyHousehold, otherHousehold],
        members: [
          legacyMember,
          {
            householdId: otherHousehold.householdId,
            memberId: existingMembership.memberId,
            displayName: "기존 가입자",
            linkedPrincipalUid: existingMembership.principalUid,
          },
        ],
        memberships: [existingMembership],
      }),
    );
    const captured = subject.captureLegacySessionCandidate();
    if (captured.kind !== "complete") {
      throw new Error("완전 후보가 필요합니다.");
    }
    const before = await subject.snapshot();

    const result = await subject.claimLegacySession({
      principalUid: existingMembership.principalUid,
      candidate: captured.candidate,
      userConfirmed: true,
      idempotencyKey: "legacy-existing-membership",
    });

    expect(result).toEqual({
      kind: "conflict",
      code: "PRINCIPAL_ALREADY_JOINED",
    });
    const after = await subject.snapshot();
    expect(after.members).toEqual(before.members);
    expect(after.memberships).toEqual(before.memberships);
    expect(after.webLocalStorage).toEqual(before.webLocalStorage);
    expect(after.businessDataDigest).toBe(before.businessDataDigest);
  });

  it("[T-HH-002][HH-001/HH-002] 존재하지 않는 memberId는 이름으로 추정하지 않고 첫 방문으로 보낸다", async () => {
    const subject = createSubject(
      fixture({
        webLocalStorage: {
          householdKey: legacyHousehold.legacyHouseholdKey,
          currentMemberId: "missing-member",
          currentMemberName: legacyMember.displayName,
        },
      }),
    );

    const captured = subject.captureLegacySessionCandidate();
    expect(captured.kind).toBe("complete");
    await expect(subject.resolveSignedInUser("google-invalid-candidate")).resolves.toEqual({
      kind: "first-visit-required",
      choices: ["create", "join"],
    });

    const state = await subject.snapshot();
    expect(state.memberships).toHaveLength(0);
    expect(state.members[0]).not.toHaveProperty("linkedPrincipalUid");
  });
});
