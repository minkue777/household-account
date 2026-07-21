import type {
  MemberRenameInputPort,
  MemberRenameResult,
  RenameSelfCommand,
  VerifiedMemberRenameActor,
} from "./ports/in/memberRenameInputPort";
import type { MemberRenameStorePort } from "./ports/out/memberRenameStorePort";
import type {
  MemberRenameReceipt,
  RenameableHouseholdMember,
} from "../domain/model/memberRename";
import {
  displayNameExists,
  isVerifiedSelfMember,
  memberRenamedEvent,
  renamePayloadFingerprint,
  validateMemberDisplayName,
} from "../domain/policies/memberRenamePolicy";

export interface MemberRenameApplicationDependencies {
  store: MemberRenameStorePort;
}

function toSuccess(member: RenameableHouseholdMember): MemberRenameResult {
  return {
    kind: "success",
    member: {
      memberId: member.memberId,
      displayName: member.displayName,
      aggregateVersion: member.aggregateVersion,
    },
  };
}

class DefaultMemberRenameApplication implements MemberRenameInputPort {
  constructor(private readonly dependencies: MemberRenameApplicationDependencies) {}

  async renameSelf(
    actor: VerifiedMemberRenameActor,
    input: RenameSelfCommand,
  ): Promise<MemberRenameResult> {
    if (Object.prototype.hasOwnProperty.call(input, "memberId")) {
      return { kind: "validation-error", code: "UNEXPECTED_MEMBER_ID" };
    }

    const name = validateMemberDisplayName(input.displayName);
    if (name.kind === "invalid") {
      return { kind: "validation-error", code: name.code };
    }

    return this.dependencies.store.transact<MemberRenameResult>((state) => {
      if (!isVerifiedSelfMember(state, actor)) {
        return {
          state,
          value: { kind: "forbidden", code: "RENAME_SELF_FORBIDDEN" },
        };
      }

      const payloadFingerprint = renamePayloadFingerprint({
        memberId: actor.actingMemberId,
        displayName: name.displayName,
        expectedVersion: input.expectedVersion,
      });
      const priorReceipt = state.receipts.find(
        (receipt) => receipt.idempotencyKey === input.idempotencyKey,
      );
      if (priorReceipt !== undefined) {
        return {
          state,
          value:
            priorReceipt.payloadFingerprint === payloadFingerprint
              ? priorReceipt.result
              : {
                  kind: "conflict",
                  code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
                },
        };
      }

      const member = state.members.find(
        (candidate) =>
          candidate.memberId === actor.actingMemberId &&
          candidate.principalUid === actor.principalUid,
      );
      if (member === undefined) {
        return {
          state,
          value: { kind: "forbidden", code: "RENAME_SELF_FORBIDDEN" },
        };
      }
      if (displayNameExists(state, member.memberId, name.displayName)) {
        return {
          state,
          value: { kind: "conflict", code: "DISPLAY_NAME_EXISTS" },
        };
      }
      if (member.aggregateVersion !== input.expectedVersion) {
        return {
          state,
          value: {
            kind: "conflict",
            code: "VERSION_MISMATCH",
            currentVersion: member.aggregateVersion,
          },
        };
      }

      const renamed: RenameableHouseholdMember = {
        ...member,
        displayName: name.displayName,
        aggregateVersion: member.aggregateVersion + 1,
      };
      const success = toSuccess(renamed);
      if (success.kind !== "success") {
        throw new Error("Member rename success mapping invariant failed");
      }
      const receipt: MemberRenameReceipt = {
        idempotencyKey: input.idempotencyKey,
        payloadFingerprint,
        result: success,
      };

      return {
        state: {
          ...state,
          members: state.members.map((candidate) =>
            candidate.memberId === renamed.memberId ? renamed : candidate,
          ),
          memberOwnerProfiles: state.memberOwnerProfiles.map((profile) =>
            profile.linkedMemberId === renamed.memberId
              ? { ...profile, displayName: renamed.displayName }
              : profile,
          ),
          receipts: [...state.receipts, receipt],
          events: [
            ...state.events,
            memberRenamedEvent(state.householdId, renamed),
          ],
        },
        value: success,
      };
    });
  }
}

export function createMemberRenameApplication(
  dependencies: MemberRenameApplicationDependencies,
): MemberRenameInputPort {
  return new DefaultMemberRenameApplication(dependencies);
}
