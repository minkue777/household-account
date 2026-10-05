import type { MemberRenameInputPort, MemberRenameResult } from "./ports/in/memberRenameInputPort";
import type { MemberRenameStorePort } from "./ports/out/memberRenameStorePort";
import { renamePayloadFingerprint, validateMemberDisplayName } from "../domain/policies/memberRenamePolicy";

export function createMemberRenameApplication(dependencies: { store: MemberRenameStorePort }): MemberRenameInputPort {
  return {
    async renameSelf(actor, input) {
      if (Object.prototype.hasOwnProperty.call(input, "memberId")) {
        return { kind: "validation-error", code: "UNEXPECTED_MEMBER_ID" };
      }
      const name = validateMemberDisplayName(input.displayName);
      if (name.kind === "invalid") return { kind: "validation-error", code: name.code };
      const payloadFingerprint = renamePayloadFingerprint({
        memberId: actor.actingMemberId, displayName: name.displayName, expectedVersion: input.expectedVersion,
      });
      return dependencies.store.transact<MemberRenameResult>(actor, name.displayName, input.idempotencyKey, snapshot => {
        const { member, receipt } = snapshot;
        if (!snapshot.activeSelf || member === undefined || member.principalUid !== actor.principalUid) {
          return { value: { kind: "forbidden", code: "RENAME_SELF_FORBIDDEN" } };
        }
        if (receipt !== undefined) {
          return { value: receipt.payloadFingerprint === payloadFingerprint
            ? receipt.result : { kind: "conflict", code: "IDEMPOTENCY_PAYLOAD_MISMATCH" } };
        }
        if (snapshot.displayNameTaken) return { value: { kind: "conflict", code: "DISPLAY_NAME_EXISTS" } };
        if (member.aggregateVersion !== input.expectedVersion) {
          return { value: { kind: "conflict", code: "VERSION_MISMATCH", currentVersion: member.aggregateVersion } };
        }
        const renamed = { ...member, displayName: name.displayName, aggregateVersion: member.aggregateVersion + 1 };
        const value = { kind: "success" as const, member: {
          memberId: renamed.memberId, displayName: renamed.displayName, aggregateVersion: renamed.aggregateVersion,
        } };
        return { value, change: { member: renamed, receipt: { idempotencyKey: input.idempotencyKey, payloadFingerprint, result: value } } };
      });
    },
  };
}
