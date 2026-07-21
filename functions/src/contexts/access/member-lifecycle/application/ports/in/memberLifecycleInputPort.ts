export interface HouseholdMemberAdminActor {
  principalRef: string;
  capabilities: readonly (
    | "admin.household-members.remove"
    | "admin.household-members.restore"
  )[];
}

export interface RemoveHouseholdMemberCommand {
  householdId: string;
  memberId: string;
  reason: string;
  expectedMembershipVersion: number;
  idempotencyKey: string;
}

export interface RestoreRemovedHouseholdMemberCommand {
  householdId: string;
  memberId: string;
  expectedMembershipVersion: number;
  idempotencyKey: string;
}

export type MemberLifecycleCommandResult =
  | {
      kind: "success";
      memberId: string;
      membershipStatus: "active" | "removed";
      membershipVersion: number;
    }
  | { kind: "already-processed"; memberId: string; membershipVersion: number }
  | { kind: "forbidden"; code: string }
  | { kind: "conflict"; code: string };

export interface MemberLifecycleInputPort {
  removeHouseholdMember(
    actor: HouseholdMemberAdminActor,
    input: RemoveHouseholdMemberCommand,
  ): Promise<MemberLifecycleCommandResult>;
  restoreRemovedHouseholdMember(
    actor: HouseholdMemberAdminActor,
    input: RestoreRemovedHouseholdMemberCommand,
  ): Promise<MemberLifecycleCommandResult>;
  authorizeMember(memberId: string): Promise<"allowed" | "forbidden">;
}
