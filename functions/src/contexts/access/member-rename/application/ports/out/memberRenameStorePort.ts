import type { MemberRenameReceipt, RenameableHouseholdMember } from "../../../domain/model/memberRename";
import type { VerifiedMemberRenameActor } from "../in/memberRenameInputPort";

export interface MemberRenameSnapshot {
  readonly member?: RenameableHouseholdMember;
  readonly activeSelf: boolean;
  readonly displayNameTaken: boolean;
  readonly receipt?: MemberRenameReceipt;
}

export interface MemberRenameMutation<T> {
  readonly value: T;
  readonly change?: {
    readonly member: RenameableHouseholdMember;
    readonly receipt: MemberRenameReceipt;
  };
}

export interface MemberRenameStorePort {
  transact<T>(
    actor: VerifiedMemberRenameActor,
    displayName: string,
    idempotencyKey: string,
    operation: (snapshot: MemberRenameSnapshot) => MemberRenameMutation<T>,
  ): Promise<T>;
}
