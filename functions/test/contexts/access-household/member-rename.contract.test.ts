import { describe, expect, it } from "vitest";
import type {
  MemberRenameInputPort,
  RenameSelfCommand,
  VerifiedMemberRenameActor,
} from "../../../src/contexts/access/public";
import {
  createMemberRenameFixtureSubject,
  type MemberRenameFixture,
  type MemberRenameFixtureSubject,
  type MemberRenameSnapshot,
} from "../../support/member-rename-fixture";

/**
 * 자기 Member 표시 이름 변경의 공개 Application 경계입니다.
 * stableReferences는 다른 Context가 보유한 memberId 참조의 최종 지문이며
 * 각 저장소 호출 여부처럼 구현에 종속된 상호작용은 노출하지 않습니다.
 */
export interface MemberRenameSubject extends MemberRenameInputPort {
  snapshot(): Promise<MemberRenameSnapshot>;
  publishedEvents(): ReturnType<MemberRenameFixtureSubject["publishedEvents"]>;
}

const actor: VerifiedMemberRenameActor = {
  principalUid: "uid-min",
  householdId: "house-1",
  actingMemberId: "member-min",
};

const fixture = (): MemberRenameFixture => ({
  householdId: "house-1",
  members: [
    {
      principalUid: actor.principalUid,
      memberId: actor.actingMemberId,
      displayName: "민규",
      aggregateVersion: 3,
    },
    {
      principalUid: "uid-jin",
      memberId: "member-jin",
      displayName: "진선",
      aggregateVersion: 2,
    },
  ],
  stableReferences: {
    transactions: ["transaction:member-min"],
    assets: ["asset:member-min"],
    registeredCards: ["card:member-min"],
    notificationEndpoints: ["endpoint:member-min"],
  },
});

export function createSubject(): MemberRenameSubject {
  return createMemberRenameFixtureSubject(fixture());
}

describe("자기 가구원 표시 이름 변경 공개 계약", () => {
  it("[T-HH-004][HH-009] 자기 이름 변경은 안정 ID를 유지하고 Member와 연결 명의자의 이름만 원자 변경한다", async () => {
    const subject = createSubject();
    const before = await subject.snapshot();

    const result = await subject.renameSelf(actor, {
      displayName: "  민규 새 이름  ",
      expectedVersion: 3,
      idempotencyKey: "rename-self-1",
    });

    expect(result).toEqual({
      kind: "success",
      member: {
        memberId: "member-min",
        displayName: "민규 새 이름",
        aggregateVersion: 4,
      },
    });
    const after = await subject.snapshot();
    expect(after.members).toEqual(
      expect.arrayContaining([
        {
          memberId: "member-min",
          displayName: "민규 새 이름",
          aggregateVersion: 4,
        },
        expect.objectContaining({ memberId: "member-jin", displayName: "진선" }),
      ]),
    );
    expect(after.memberOwnerProfiles).toEqual(
      expect.arrayContaining([
        {
          profileId: "profile-member-min",
          linkedMemberId: "member-min",
          displayName: "민규 새 이름",
        },
      ]),
    );
    expect(after.stableReferences).toEqual(before.stableReferences);
    expect(await subject.publishedEvents()).toEqual([
      {
        eventType: "MemberRenamed.v1",
        householdId: "house-1",
        memberId: "member-min",
        newDisplayName: "민규 새 이름",
      },
    ]);
  });

  it("[T-HH-004][HH-009] 다른 memberId를 주입한 요청은 입력 경계에서 거부한다", async () => {
    const subject = createSubject();
    const before = await subject.snapshot();
    const forgedInput: RenameSelfCommand & { memberId: string } = {
      displayName: "공격자가 지정한 이름",
      expectedVersion: 2,
      idempotencyKey: "rename-forged-target",
      memberId: "member-jin",
    };

    const result = await subject.renameSelf(actor, forgedInput);

    expect(result).toEqual({
      kind: "validation-error",
      code: "UNEXPECTED_MEMBER_ID",
    });
    expect(await subject.snapshot()).toEqual(before);
    expect(await subject.publishedEvents()).toEqual([]);
  });

  it("[T-HH-004][HH-009] 공백 이름과 같은 가구의 중복 이름은 상태와 Event를 바꾸지 않는다", async () => {
    const subject = createSubject();
    const before = await subject.snapshot();

    await expect(
      subject.renameSelf(actor, {
        displayName: "   ",
        expectedVersion: 3,
        idempotencyKey: "rename-empty",
      }),
    ).resolves.toEqual({
      kind: "validation-error",
      code: "INVALID_MEMBER_NAME",
    });
    await expect(
      subject.renameSelf(actor, {
        displayName: "진선",
        expectedVersion: 3,
        idempotencyKey: "rename-duplicate",
      }),
    ).resolves.toEqual({
      kind: "conflict",
      code: "DISPLAY_NAME_EXISTS",
    });
    expect(await subject.snapshot()).toEqual(before);
    expect(await subject.publishedEvents()).toEqual([]);
  });

  it("[T-HH-004][HH-009] stale version 변경은 현재 version을 알리고 lost update를 만들지 않는다", async () => {
    const subject = createSubject();
    const before = await subject.snapshot();

    const result = await subject.renameSelf(actor, {
      displayName: "충돌 이름",
      expectedVersion: 2,
      idempotencyKey: "rename-stale-version",
    });

    expect(result).toEqual({
      kind: "conflict",
      code: "VERSION_MISMATCH",
      currentVersion: 3,
    });
    expect(await subject.snapshot()).toEqual(before);
    expect(await subject.publishedEvents()).toEqual([]);
  });

  it("[T-HH-004][HH-009] 같은 멱등 키와 같은 payload 재시도는 최초 결과를 재생하고 Event를 중복 발행하지 않는다", async () => {
    const subject = createSubject();
    const command: RenameSelfCommand = {
      displayName: "재시도 이름",
      expectedVersion: 3,
      idempotencyKey: "rename-replay",
    };

    const first = await subject.renameSelf(actor, command);
    const replay = await subject.renameSelf(actor, command);

    expect(replay).toEqual(first);
    expect((await subject.snapshot()).members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberId: "member-min",
          displayName: "재시도 이름",
          aggregateVersion: 4,
        }),
      ]),
    );
    expect(await subject.publishedEvents()).toHaveLength(1);
  });

  it("[T-HH-004][HH-009] 같은 멱등 키의 다른 payload는 충돌로 거부하고 최초 변경을 보존한다", async () => {
    const subject = createSubject();
    await subject.renameSelf(actor, {
      displayName: "최초 이름",
      expectedVersion: 3,
      idempotencyKey: "rename-payload-conflict",
    });
    const afterFirst = await subject.snapshot();

    const conflict = await subject.renameSelf(actor, {
      displayName: "다른 이름",
      expectedVersion: 4,
      idempotencyKey: "rename-payload-conflict",
    });

    expect(conflict).toEqual({
      kind: "conflict",
      code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
    });
    expect(await subject.snapshot()).toEqual(afterFirst);
    expect(await subject.publishedEvents()).toHaveLength(1);
  });

  it("[T-HH-004][T-HH-SEC-001][HH-009] 타 Principal·타 가구 actor는 어떤 Member도 변경하지 못한다", async () => {
    const attempts: VerifiedMemberRenameActor[] = [
      { ...actor, principalUid: "uid-attacker" },
      { ...actor, householdId: "house-other" },
    ];

    for (const [index, forgedActor] of attempts.entries()) {
      const subject = createSubject();
      const before = await subject.snapshot();

      await expect(
        subject.renameSelf(forgedActor, {
          displayName: "권한 없는 이름",
          expectedVersion: 3,
          idempotencyKey: `rename-forbidden-${index}`,
        }),
      ).resolves.toEqual({
        kind: "forbidden",
        code: "RENAME_SELF_FORBIDDEN",
      });
      expect(await subject.snapshot()).toEqual(before);
      expect(await subject.publishedEvents()).toEqual([]);
    }
  });
});
