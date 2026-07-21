import {
  resolveLegacyMemberReference,
  type LegacyMemberReference,
  type MemberReferenceCandidate,
  type MemberReferenceResolution,
} from "../../src/platform/compatibility/member-reference/public";

export interface MemberReferenceFixture {
  readonly members: readonly MemberReferenceCandidate[];
  readonly legacyRecords: readonly LegacyMemberReference[];
}

export interface MemberReferenceMigrationFixtureSubject {
  resolve(recordId: string): MemberReferenceResolution;
  renameMember(input: { memberId: string; displayName: string }): void;
  read(recordId: string): MemberReferenceResolution;
}

export function createMemberReferenceMigrationFixture(
  fixture: MemberReferenceFixture,
): MemberReferenceMigrationFixtureSubject {
  let members = fixture.members.map((member) => ({ ...member }));
  const records = new Map(
    fixture.legacyRecords.map((record) => [record.recordId, { ...record }]),
  );

  const resolve = (recordId: string): MemberReferenceResolution => {
    const record = records.get(recordId);
    if (record === undefined) {
      return {
        kind: "manual-reconciliation-required",
        code: "LEGACY_MEMBER_REFERENCE_UNMAPPED",
      };
    }
    const result = resolveLegacyMemberReference({ record, members });
    if (result.kind === "resolved") {
      records.set(recordId, {
        ...record,
        ownerMemberId: result.ownerMemberId,
        legacyOwnerName: result.legacyOwnerName,
      });
    }
    return result;
  };

  return {
    resolve,
    renameMember(input) {
      members = members.map((member) =>
        member.memberId === input.memberId
          ? { ...member, displayName: input.displayName }
          : member,
      );
    },
    read: resolve,
  };
}
