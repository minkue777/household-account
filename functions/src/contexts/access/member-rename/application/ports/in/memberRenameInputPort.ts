export interface VerifiedMemberRenameActor {
  principalUid: string;
  householdId: string;
  actingMemberId: string;
}

export interface RenameSelfCommand {
  displayName: string;
  expectedVersion: number;
  idempotencyKey: string;
}

export interface RenamedMemberView {
  memberId: string;
  displayName: string;
  aggregateVersion: number;
}

export type MemberRenameResult =
  | { kind: "success"; member: RenamedMemberView }
  | { kind: "validation-error"; code: string }
  | { kind: "conflict"; code: string; currentVersion?: number }
  | { kind: "forbidden"; code: string };

export interface MemberRenameInputPort {
  renameSelf(
    actor: VerifiedMemberRenameActor,
    input: RenameSelfCommand,
  ): Promise<MemberRenameResult>;
}
