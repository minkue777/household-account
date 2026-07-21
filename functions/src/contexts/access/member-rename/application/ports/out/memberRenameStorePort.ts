import type { MemberRenameState } from "../../../domain/model/memberRename";

export interface MemberRenameMutation<T> {
  state: MemberRenameState;
  value: T;
}

export interface MemberRenameStorePort {
  read(): Promise<MemberRenameState>;
  transact<T>(
    operation: (state: MemberRenameState) => MemberRenameMutation<T>,
  ): Promise<T>;
}
