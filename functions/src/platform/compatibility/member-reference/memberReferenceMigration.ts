export interface MemberReferenceCandidate {
  readonly householdId: string;
  readonly memberId: string;
  readonly displayName: string;
}

export interface LegacyMemberReference {
  readonly householdId: string;
  readonly recordId: string;
  readonly ownerName: string;
  readonly ownerMemberId?: string;
  readonly legacyOwnerName?: string;
}

export type MemberReferenceResolution =
  | {
      readonly kind: "resolved";
      readonly recordId: string;
      readonly ownerMemberId: string;
      readonly legacyOwnerName: string;
    }
  | {
      readonly kind: "manual-reconciliation-required";
      readonly code:
        | "LEGACY_MEMBER_REFERENCE_UNMAPPED"
        | "LEGACY_MEMBER_REFERENCE_AMBIGUOUS";
    };

export function resolveLegacyMemberReference(input: {
  readonly record: LegacyMemberReference;
  readonly members: readonly MemberReferenceCandidate[];
}): MemberReferenceResolution {
  if (input.record.ownerMemberId !== undefined) {
    return {
      kind: "resolved",
      recordId: input.record.recordId,
      ownerMemberId: input.record.ownerMemberId,
      legacyOwnerName:
        input.record.legacyOwnerName ?? input.record.ownerName,
    };
  }

  const candidates = input.members.filter(
    (member) =>
      member.householdId === input.record.householdId &&
      member.displayName === input.record.ownerName,
  );
  if (candidates.length === 0) {
    return {
      kind: "manual-reconciliation-required",
      code: "LEGACY_MEMBER_REFERENCE_UNMAPPED",
    };
  }
  if (candidates.length > 1) {
    return {
      kind: "manual-reconciliation-required",
      code: "LEGACY_MEMBER_REFERENCE_AMBIGUOUS",
    };
  }
  return {
    kind: "resolved",
    recordId: input.record.recordId,
    ownerMemberId: candidates[0]!.memberId,
    legacyOwnerName: input.record.ownerName,
  };
}
