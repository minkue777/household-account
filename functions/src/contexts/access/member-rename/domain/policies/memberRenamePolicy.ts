import type {
  MemberRenamedEvent,
  RenameableHouseholdMember,
} from "../model/memberRename";

export type MemberDisplayNameValidation =
  | { kind: "valid"; displayName: string }
  | { kind: "invalid"; code: "INVALID_MEMBER_NAME" };

export function validateMemberDisplayName(
  displayName: string,
): MemberDisplayNameValidation {
  const normalized = displayName.trim();
  return normalized.length === 0
    ? { kind: "invalid", code: "INVALID_MEMBER_NAME" }
    : { kind: "valid", displayName: normalized };
}

export function memberRenamedEvent(
  householdId: string,
  member: RenameableHouseholdMember,
): MemberRenamedEvent {
  return {
    eventType: "MemberRenamed.v1",
    householdId,
    memberId: member.memberId,
    newDisplayName: member.displayName,
  };
}

export function renamePayloadFingerprint(input: {
  memberId: string;
  displayName: string;
  expectedVersion: number;
}): string {
  return JSON.stringify([
    input.memberId,
    input.displayName,
    input.expectedVersion,
  ]);
}
