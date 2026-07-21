import { describe, expect, it } from "vitest";
import type {
  GoogleOnboardingInputPort,
  VerifiedGooglePrincipal,
} from "../../../src/contexts/access/public";
import {
  createGoogleOnboardingFixtureSubject,
  type GoogleOnboardingFixture,
  type OnboardingSnapshot,
  type PublicAccessEvent,
} from "../../support/google-onboarding-invitation-fixture";

/**
 * Access 공개 Input Port와 최종 Canonical 상태를 잇는 계약 Subject입니다.
 * `setCurrentTime`과 snapshot/event 조회는 테스트 driver이며 제품 Wire API가 아닙니다.
 */
export interface GoogleOnboardingInvitationSubject
  extends GoogleOnboardingInputPort {
  setCurrentTime(instant: string): void;
  snapshot(): Promise<OnboardingSnapshot>;
  publishedEvents(): Promise<readonly PublicAccessEvent[]>;
}

export function createSubject(
  fixture: GoogleOnboardingFixture = {},
): GoogleOnboardingInvitationSubject {
  return createGoogleOnboardingFixtureSubject(fixture);
}

const creator = { uid: "google-creator" };

async function createHousehold(
  subject: GoogleOnboardingInvitationSubject,
  principal: VerifiedGooglePrincipal = creator,
) {
  const result = await subject.createHouseholdWithSelf(principal, {
    householdName: "우리 가계부",
    selfDisplayName: "민규",
    idempotencyKey: `create-${principal.uid}`,
  });

  expect(result.kind).toBe("success");
  if (result.kind !== "success") {
    throw new Error("테스트 준비용 가구 생성에 실패했습니다.");
  }
  return result;
}

async function issueInvitation(
  subject: GoogleOnboardingInvitationSubject,
  householdId: string,
  principal: VerifiedGooglePrincipal = creator,
  idempotencyKey = `invite-${principal.uid}-${householdId}`,
) {
  const result = await subject.createInvitationCode(principal, {
    householdId,
    idempotencyKey,
  });

  expect(result.kind).toBe("success");
  if (result.kind !== "success") {
    throw new Error("테스트 준비용 초대 코드 발급에 실패했습니다.");
  }
  return result;
}

describe("Google 로그인·자기 가구 생성·5분 초대 공개 계약", () => {
  it("[T-HH-003][HH-003/HH-006/HH-007] 첫 방문자는 자기 Member 하나만 만들고 생성자 특권을 갖지 않는다", async () => {
    const subject = createSubject();
    subject.setCurrentTime("2026-07-19T09:00:00.000Z");

    await expect(subject.resolveSignedInUser(creator)).resolves.toEqual({
      kind: "first-visit-required",
      choices: ["create", "join"],
    });

    const created = await createHousehold(subject);
    const state = await subject.snapshot();

    expect(created).toEqual({
      kind: "success",
      householdId: expect.any(String),
      memberId: expect.any(String),
      membership: {
        householdId: created.householdId,
        memberId: created.memberId,
        status: "active",
        capabilities: expect.any(Array),
      },
      initializationStatus: expect.stringMatching(/^(pending|completed|failed)$/),
    });
    expect(state.members).toEqual([
      {
        householdId: created.householdId,
        memberId: created.memberId,
        linkedPrincipalUid: creator.uid,
        displayName: "민규",
      },
    ]);
    expect(state.memberships).toHaveLength(1);
    expect(state.principalClaims).toEqual([
      {
        principalUid: creator.uid,
        householdId: created.householdId,
        memberId: created.memberId,
        version: 1,
      },
    ]);
    expect(state.memberships[0]).not.toHaveProperty("role");
    expect(state.memberships[0]).not.toHaveProperty("owner");

    const events = await subject.publishedEvents();
    expect(
      events.filter((event) => event.eventType === "HouseholdCreated.v1"),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.eventType === "MemberJoined.v1"),
    ).toHaveLength(1);
  });

  it.each([
    {
      name: "빈 가구 이름",
      input: {
        householdName: "   ",
        selfDisplayName: "민규",
        idempotencyKey: "blank-household-name",
      },
      code: "HOUSEHOLD_NAME_REQUIRED" as const,
    },
    {
      name: "빈 자기 이름",
      input: {
        householdName: "우리 가계부",
        selfDisplayName: "\t",
        idempotencyKey: "blank-self-name",
      },
      code: "SELF_DISPLAY_NAME_REQUIRED" as const,
    },
  ])(
    "[T-HH-003][HH-006/HH-007] $name은 부분 Household·Member·Membership·claim 없이 거부한다",
    async ({ input, code }) => {
      const subject = createSubject();

      await expect(
        subject.createHouseholdWithSelf(creator, input),
      ).resolves.toEqual({ kind: "validation-error", code });
      expect(await subject.snapshot()).toEqual({
        households: [],
        members: [],
        memberships: [],
        principalClaims: [],
        initializations: [],
        invitations: [],
      });
      expect(await subject.publishedEvents()).toEqual([]);
    },
  );

  it("[T-HH-003][HH-006/HH-007] Wire 입력의 타인 principalUid·memberId 지정은 자기 생성으로 무시하지 않고 거부한다", async () => {
    const subject = createSubject();
    const forgedInput = {
      householdName: "우리 가계부",
      selfDisplayName: "민규",
      idempotencyKey: "forged-self-create",
      principalUid: "different-user",
      memberId: "chosen-member-id",
    };

    await expect(
      subject.createHouseholdWithSelf(creator, forgedInput),
    ).resolves.toEqual({
      kind: "validation-error",
      code: "FORBIDDEN_IDENTITY_FIELD",
    });
    expect((await subject.snapshot()).memberships).toEqual([]);
    expect((await subject.snapshot()).principalClaims).toEqual([]);
  });

  it("[T-HH-003][HH-007] 생성자와 초대 가입자는 같은 일반 capability를 가지며 creator 전용 권한이 없다", async () => {
    const subject = createSubject();
    subject.setCurrentTime("2026-07-19T09:00:00.000Z");
    const created = await createHousehold(subject);
    const invitation = await issueInvitation(subject, created.householdId);
    const invitee = { uid: "google-invitee-with-same-rights" };

    const joined = await subject.joinHouseholdAsSelf(invitee, {
      invitationCode: invitation.invitationCode,
      selfDisplayName: "진선",
      idempotencyKey: "join-for-capability-comparison",
    });
    expect(joined.kind).toBe("success");
    const state = await subject.snapshot();
    const creatorMembership = state.memberships.find(
      ({ principalUid }) => principalUid === creator.uid,
    );
    const inviteeMembership = state.memberships.find(
      ({ principalUid }) => principalUid === invitee.uid,
    );

    expect(creatorMembership?.capabilities).toEqual(
      inviteeMembership?.capabilities,
    );
    expect(creatorMembership?.capabilities).not.toEqual(
      expect.arrayContaining([
        "household.delete",
        "household.purge.permanent",
        "admin.household-members.remove",
      ]),
    );
    expect(state.members).toContainEqual(
      expect.objectContaining({
        linkedPrincipalUid: invitee.uid,
        displayName: "진선",
      }),
    );
    expect(state.principalClaims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ principalUid: creator.uid }),
        expect.objectContaining({ principalUid: invitee.uid }),
      ]),
    );
  });

  it("[T-HH-003][HH-007] 후속 Context 초기화 실패는 생성한 Access 상태를 롤백하거나 성공으로 위장하지 않는다", async () => {
    const subject = createSubject({ initializationOutcome: "failed" });

    const result = await subject.createHouseholdWithSelf(creator, {
      householdName: "초기화 재시도 가계부",
      selfDisplayName: "민규",
      idempotencyKey: "create-with-initialization-failure",
    });

    expect(result).toEqual(
      expect.objectContaining({
        kind: "success",
        initializationStatus: "failed",
      }),
    );
    const state = await subject.snapshot();
    expect(state.households).toHaveLength(1);
    expect(state.members).toHaveLength(1);
    expect(state.memberships).toHaveLength(1);
    expect(state.principalClaims).toHaveLength(1);
    expect(state.initializations).toEqual([
      expect.objectContaining({ status: "failed" }),
    ]);
    expect(
      (await subject.publishedEvents()).filter(
        ({ eventType }) => eventType === "HouseholdCreated.v1",
      ),
    ).toHaveLength(1);
  });

  it("[T-HH-003][HH-007/DEC-034] 기존 UID claim이 있는 사용자의 추가 가구 생성은 아무 부분 상태 없이 충돌한다", async () => {
    const subject = createSubject();
    await createHousehold(subject);
    const before = await subject.snapshot();

    await expect(
      subject.createHouseholdWithSelf(creator, {
        householdName: "두 번째 가계부",
        selfDisplayName: "민규",
        idempotencyKey: "second-household-not-allowed",
      }),
    ).resolves.toEqual({
      kind: "conflict",
      code: "PRINCIPAL_ALREADY_JOINED",
    });
    expect(await subject.snapshot()).toEqual(before);
  });

  it("[T-HH-JOIN-001][HH-JOIN-001] 코드는 발급 후 5분 직전까지 유효하고 expiresAt부터 사용할 수 없다", async () => {
    const subject = createSubject();
    subject.setCurrentTime("2026-07-19T09:00:00.000Z");
    const created = await createHousehold(subject);
    const beforeBoundary = await issueInvitation(subject, created.householdId);

    expect(beforeBoundary.expiresAt).toBe("2026-07-19T09:05:00.000Z");
    subject.setCurrentTime("2026-07-19T09:04:59.999Z");
    await expect(
      subject.joinHouseholdAsSelf(
        { uid: "google-before-boundary" },
        {
          invitationCode: beforeBoundary.invitationCode,
          selfDisplayName: "진선",
          idempotencyKey: "join-before-boundary",
        },
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "success",
        householdId: created.householdId,
      }),
    );

    subject.setCurrentTime("2026-07-19T10:00:00.000Z");
    const atBoundary = await issueInvitation(
      subject,
      created.householdId,
      creator,
      "invite-at-expiry-boundary",
    );
    subject.setCurrentTime(atBoundary.expiresAt);
    const expired = await subject.joinHouseholdAsSelf(
      { uid: "google-at-boundary" },
      {
        invitationCode: atBoundary.invitationCode,
        selfDisplayName: "지아",
        idempotencyKey: "join-at-boundary",
      },
    );

    expect(expired).toEqual({
      kind: "conflict",
      code: "INVITATION_EXPIRED_OR_USED",
    });
    const state = await subject.snapshot();
    expect(
      state.members.filter(
        (member) => member.linkedPrincipalUid === "google-at-boundary",
      ),
    ).toHaveLength(0);
  });

  it("[T-HH-JOIN-001][HH-JOIN-001] 초대 원문은 한 번만 반환하고 한 Principal의 성공 뒤 재사용할 수 없다", async () => {
    const subject = createSubject();
    subject.setCurrentTime("2026-07-19T09:00:00.000Z");
    const created = await createHousehold(subject);
    const invitation = await issueInvitation(subject, created.householdId);

    const first = await subject.joinHouseholdAsSelf(
      { uid: "google-invitee-a" },
      {
        invitationCode: invitation.invitationCode,
        selfDisplayName: "진선",
        idempotencyKey: "join-a",
      },
    );
    const second = await subject.joinHouseholdAsSelf(
      { uid: "google-invitee-b" },
      {
        invitationCode: invitation.invitationCode,
        selfDisplayName: "지아",
        idempotencyKey: "join-b",
      },
    );

    expect(first.kind).toBe("success");
    expect(second).toEqual({
      kind: "conflict",
      code: "INVITATION_EXPIRED_OR_USED",
    });
    const state = await subject.snapshot();
    const storedInvitation = state.invitations.find(
      (candidate) => candidate.householdId === created.householdId,
    );
    expect(storedInvitation).toEqual(
      expect.objectContaining({ status: "used", usedByUid: "google-invitee-a" }),
    );
    expect(storedInvitation).not.toHaveProperty("invitationCode");
    expect(storedInvitation).not.toHaveProperty("code");
    expect(
      state.members.filter(
        (member) => member.linkedPrincipalUid === "google-invitee-b",
      ),
    ).toHaveLength(0);
  });

  it.each([
    {
      name: "공백 자기 이름",
      extra: { selfDisplayName: "  " },
      code: "SELF_DISPLAY_NAME_REQUIRED" as const,
    },
    {
      name: "타인 identity 필드 위조",
      extra: {
        selfDisplayName: "진선",
        principalUid: "different-user",
        memberId: "chosen-member-id",
      },
      code: "FORBIDDEN_IDENTITY_FIELD" as const,
    },
  ])(
    "[T-HH-003/T-HH-JOIN-001][HH-006/HH-JOIN-001] $name 가입 요청은 Invitation·Member·Membership·claim을 변경하지 않는다",
    async ({ extra, code }) => {
      const subject = createSubject();
      subject.setCurrentTime("2026-07-19T09:00:00.000Z");
      const created = await createHousehold(subject);
      const invitation = await issueInvitation(subject, created.householdId);
      const before = await subject.snapshot();
      const forgedOrInvalidInput = {
        invitationCode: invitation.invitationCode,
        idempotencyKey: `invalid-join-${code}`,
        ...extra,
      };

      await expect(
        subject.joinHouseholdAsSelf(
          { uid: "google-invalid-joiner" },
          forgedOrInvalidInput,
        ),
      ).resolves.toEqual({ kind: "validation-error", code });
      expect(await subject.snapshot()).toEqual(before);
    },
  );

  it("[T-HH-JOIN-001][HH-JOIN-001/DEC-034] 이미 Membership이 있는 UID의 가입 실패는 Invitation을 소비하지 않는다", async () => {
    const subject = createSubject();
    subject.setCurrentTime("2026-07-19T09:00:00.000Z");
    await createHousehold(subject, { uid: "already-member" });
    const target = await createHousehold(subject, creator);
    const invitation = await issueInvitation(subject, target.householdId);

    const result = await subject.joinHouseholdAsSelf(
      { uid: "already-member" },
      {
        invitationCode: invitation.invitationCode,
        selfDisplayName: "중복 가입",
        idempotencyKey: "joined-principal-rejected",
      },
    );

    expect(result).toEqual({
      kind: "conflict",
      code: "PRINCIPAL_ALREADY_JOINED",
    });
    const state = await subject.snapshot();
    expect(
      state.invitations.find(
        (candidate) => candidate.householdId === target.householdId,
      ),
    ).toEqual(expect.objectContaining({ status: "issued" }));
    expect(
      state.memberships.filter(
        (membership) => membership.principalUid === "already-member",
      ),
    ).toHaveLength(1);
  });

  it("[T-HH-JOIN-001][HH-JOIN-001/DEC-034] 같은 코드를 동시에 사용해도 한 Principal만 가입한다", async () => {
    const subject = createSubject();
    subject.setCurrentTime("2026-07-19T09:00:00.000Z");
    const created = await createHousehold(subject);
    const invitation = await issueInvitation(subject, created.householdId);

    const results = await Promise.all([
      subject.joinHouseholdAsSelf(
        { uid: "racer-a" },
        {
          invitationCode: invitation.invitationCode,
          selfDisplayName: "가입자 A",
          idempotencyKey: "race-a",
        },
      ),
      subject.joinHouseholdAsSelf(
        { uid: "racer-b" },
        {
          invitationCode: invitation.invitationCode,
          selfDisplayName: "가입자 B",
          idempotencyKey: "race-b",
        },
      ),
    ]);

    expect(results.filter((result) => result.kind === "success")).toHaveLength(1);
    expect(results.filter((result) => result.kind === "conflict")).toEqual([
      { kind: "conflict", code: "INVITATION_EXPIRED_OR_USED" },
    ]);
    const state = await subject.snapshot();
    expect(
      state.memberships.filter((membership) =>
        ["racer-a", "racer-b"].includes(membership.principalUid),
      ),
    ).toHaveLength(1);
  });

  it("[T-HH-003][HH-007/HH-JOIN-001/DEC-034] 같은 UID의 생성·가입 경합은 하나만 성공하고 부분 상태를 남기지 않는다", async () => {
    const subject = createSubject();
    subject.setCurrentTime("2026-07-19T09:00:00.000Z");
    const inviterHousehold = await createHousehold(subject, creator);
    const invitation = await issueInvitation(subject, inviterHousehold.householdId);
    const racingPrincipal = { uid: "create-or-join" };

    const [createResult, joinResult] = await Promise.all([
      subject.createHouseholdWithSelf(racingPrincipal, {
        householdName: "경합 가계부",
        selfDisplayName: "경합 사용자",
        idempotencyKey: "race-create",
      }),
      subject.joinHouseholdAsSelf(racingPrincipal, {
        invitationCode: invitation.invitationCode,
        selfDisplayName: "경합 사용자",
        idempotencyKey: "race-join",
      }),
    ]);

    expect(
      [createResult, joinResult].filter((result) => result.kind === "success"),
    ).toHaveLength(1);
    expect(
      [createResult, joinResult].filter((result) => result.kind === "conflict"),
    ).toHaveLength(1);

    const state = await subject.snapshot();
    const memberships = state.memberships.filter(
      (membership) => membership.principalUid === racingPrincipal.uid,
    );
    const members = state.members.filter(
      (member) => member.linkedPrincipalUid === racingPrincipal.uid,
    );
    expect(memberships).toHaveLength(1);
    expect(members).toHaveLength(1);
    expect(members[0].memberId).toBe(memberships[0].memberId);
    expect(members[0].householdId).toBe(memberships[0].householdId);
  });
});
