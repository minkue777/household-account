import { describe, expect, it } from "vitest";
import {
  createMemberReferenceMigrationFixture,
  type MemberReferenceFixture,
  type MemberReferenceMigrationFixtureSubject,
} from "../../support/member-reference-migration-fixture";

export interface MemberReferenceMigrationSubject
  extends MemberReferenceMigrationFixtureSubject {}

export function createSubject(
  fixture: MemberReferenceFixture,
): MemberReferenceMigrationSubject {
  return createMemberReferenceMigrationFixture(fixture);
}

const householdId = "house-1";

describe("레거시 멤버 이름 참조 전환 계약", () => {
  it("[T-SYS-006][SYS-006] 유일하게 일치하는 이름 참조를 안정 memberId로 연결하면서 원문을 보존한다", () => {
    const subject = createSubject({
      members: [{ householdId, memberId: "member-a", displayName: "민규" }],
      legacyRecords: [{ householdId, recordId: "asset-1", ownerName: "민규" }],
    });

    expect(subject.resolve("asset-1")).toEqual({
      kind: "resolved",
      recordId: "asset-1",
      ownerMemberId: "member-a",
      legacyOwnerName: "민규",
    });
  });

  it.each([
    {
      members: [] as const,
      code: "LEGACY_MEMBER_REFERENCE_UNMAPPED",
    },
    {
      members: [
        { householdId, memberId: "member-a", displayName: "민규" },
        { householdId, memberId: "member-b", displayName: "민규" },
      ],
      code: "LEGACY_MEMBER_REFERENCE_AMBIGUOUS",
    },
  ] as const)(
    "[T-SYS-006][SYS-006] 이름 참조가 없거나 모호하면 $code로 명시적 reconciliation을 요구한다",
    ({ members, code }) => {
      const subject = createSubject({
        members,
        legacyRecords: [{ householdId, recordId: "asset-1", ownerName: "민규" }],
      });

      expect(subject.resolve("asset-1")).toEqual({
        kind: "manual-reconciliation-required",
        code,
      });
    },
  );

  it("[T-SYS-006][SYS-006] 연결 후 멤버 이름이 바뀌어도 소유권 ID와 과거 원문은 바뀌지 않는다", () => {
    const subject = createSubject({
      members: [{ householdId, memberId: "member-a", displayName: "민규" }],
      legacyRecords: [{ householdId, recordId: "asset-1", ownerName: "민규" }],
    });
    subject.resolve("asset-1");

    subject.renameMember({ memberId: "member-a", displayName: "민규(변경)" });

    expect(subject.read("asset-1")).toMatchObject({
      kind: "resolved",
      ownerMemberId: "member-a",
      legacyOwnerName: "민규",
    });
  });

  it("[T-SYS-006][SYS-006] 같은 이름이 다른 가구에 있어도 현재 가구의 유일한 멤버만 연결한다", () => {
    const subject = createSubject({
      members: [
        { householdId, memberId: "member-a", displayName: "민규" },
        { householdId: "house-2", memberId: "member-b", displayName: "민규" },
      ],
      legacyRecords: [{ householdId, recordId: "asset-1", ownerName: "민규" }],
    });

    expect(subject.resolve("asset-1")).toMatchObject({
      kind: "resolved",
      ownerMemberId: "member-a",
    });
  });

  it("[T-SYS-006][SYS-006] 이미 안정 memberId로 연결된 기록은 이름 재매칭으로 덮어쓰지 않는다", () => {
    const subject = createSubject({
      members: [{ householdId, memberId: "member-b", displayName: "민규" }],
      legacyRecords: [
        {
          householdId,
          recordId: "asset-1",
          ownerName: "민규",
          ownerMemberId: "member-a",
        },
      ],
    });

    expect(subject.resolve("asset-1")).toEqual({
      kind: "resolved",
      recordId: "asset-1",
      ownerMemberId: "member-a",
      legacyOwnerName: "민규",
    });
  });
});
