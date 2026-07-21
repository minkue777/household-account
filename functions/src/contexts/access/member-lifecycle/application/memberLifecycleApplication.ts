import type {
  HouseholdMemberAdminActor,
  MemberLifecycleCommandResult,
  MemberLifecycleInputPort,
  RemoveHouseholdMemberCommand,
  RestoreRemovedHouseholdMemberCommand,
} from "./ports/in/memberLifecycleInputPort";
import type { MemberLifecycleUnitOfWorkPort } from "./ports/out/memberLifecycleUnitOfWorkPort";
import type {
  MemberLifecycleReceipt,
  StoredMemberLifecycleResult,
} from "../domain/model/memberLifecycle";
import {
  hasLifecycleCapability,
  lifecycleMembership,
  memberLifecycleEvent,
  memberLifecyclePayloadFingerprint,
} from "../domain/policies/memberLifecyclePolicy";

export interface MemberLifecycleApplicationDependencies {
  unitOfWork: MemberLifecycleUnitOfWorkPort;
}

class DefaultMemberLifecycleApplication implements MemberLifecycleInputPort {
  constructor(
    private readonly dependencies: MemberLifecycleApplicationDependencies,
  ) {}

  async removeHouseholdMember(
    actor: HouseholdMemberAdminActor,
    input: RemoveHouseholdMemberCommand,
  ): Promise<MemberLifecycleCommandResult> {
    if (!hasLifecycleCapability(actor.capabilities, "remove")) {
      return { kind: "forbidden", code: "ADMIN_MEMBER_REMOVE_REQUIRED" };
    }
    const payloadFingerprint = memberLifecyclePayloadFingerprint({
      operation: "remove",
      householdId: input.householdId,
      memberId: input.memberId,
      expectedMembershipVersion: input.expectedMembershipVersion,
      reason: input.reason,
    });

    return this.dependencies.unitOfWork.transact<MemberLifecycleCommandResult>(
      (state) => {
        if (state.household.householdId !== input.householdId) {
          return {
            state,
            value: { kind: "conflict", code: "HOUSEHOLD_SCOPE_MISMATCH" },
          };
        }
        const prior = state.receipts.find(
          (receipt) => receipt.idempotencyKey === input.idempotencyKey,
        );
        if (prior !== undefined) {
          return {
            state,
            value:
              prior.payloadFingerprint === payloadFingerprint
                ? prior.result
                : {
                    kind: "conflict",
                    code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
                  },
          };
        }

        const membership = lifecycleMembership(state, input.memberId);
        const member = state.members.find(
          (candidate) => candidate.memberId === input.memberId,
        );
        const profile = state.memberOwnerProfiles.find(
          (candidate) => candidate.linkedMemberId === input.memberId,
        );
        if (membership === undefined || member === undefined || profile === undefined) {
          return {
            state,
            value: { kind: "conflict", code: "MEMBER_NOT_FOUND" },
          };
        }
        if (membership.status === "removed") {
          const result: StoredMemberLifecycleResult = {
            kind: "already-processed",
            memberId: input.memberId,
            membershipVersion: membership.version,
          };
          const receipt: MemberLifecycleReceipt = {
            idempotencyKey: input.idempotencyKey,
            payloadFingerprint,
            result,
          };
          return {
            state: { ...state, receipts: [...state.receipts, receipt] },
            value: result,
          };
        }
        if (membership.version !== input.expectedMembershipVersion) {
          return {
            state,
            value: { kind: "conflict", code: "VERSION_MISMATCH" },
          };
        }
        const matchingClaim = state.principalClaims.find(
          (claim) => claim.principalUid === membership.principalUid,
        );
        if (
          matchingClaim === undefined ||
          matchingClaim.householdId !== input.householdId ||
          matchingClaim.memberId !== input.memberId
        ) {
          return {
            state,
            value: { kind: "conflict", code: "CLAIM_INVARIANT_BROKEN" },
          };
        }

        const nextVersion = membership.version + 1;
        const result: StoredMemberLifecycleResult = {
          kind: "success",
          memberId: input.memberId,
          membershipStatus: "removed",
          membershipVersion: nextVersion,
        };
        const receipt: MemberLifecycleReceipt = {
          idempotencyKey: input.idempotencyKey,
          payloadFingerprint,
          result,
        };
        return {
          state: {
            ...state,
            members: state.members.map((candidate) =>
              candidate.memberId === input.memberId
                ? { ...candidate, status: "removed", version: nextVersion }
                : candidate,
            ),
            memberships: state.memberships.map((candidate) =>
              candidate.memberId === input.memberId &&
              candidate.householdId === input.householdId
                ? { ...candidate, status: "removed", version: nextVersion }
                : candidate,
            ),
            memberOwnerProfiles: state.memberOwnerProfiles.map((candidate) =>
              candidate.linkedMemberId === input.memberId
                ? { ...candidate, lifecycleState: "archived" }
                : candidate,
            ),
            principalClaims: state.principalClaims.filter(
              (claim) => claim.principalUid !== membership.principalUid,
            ),
            receipts: [...state.receipts, receipt],
            events: [
              ...state.events,
              memberLifecycleEvent({
                operation: "remove",
                householdId: input.householdId,
                memberId: input.memberId,
                membershipVersion: nextVersion,
              }),
            ],
          },
          value: result,
        };
      },
    );
  }

  async restoreRemovedHouseholdMember(
    actor: HouseholdMemberAdminActor,
    input: RestoreRemovedHouseholdMemberCommand,
  ): Promise<MemberLifecycleCommandResult> {
    if (!hasLifecycleCapability(actor.capabilities, "restore")) {
      return { kind: "forbidden", code: "ADMIN_MEMBER_RESTORE_REQUIRED" };
    }
    const payloadFingerprint = memberLifecyclePayloadFingerprint({
      operation: "restore",
      householdId: input.householdId,
      memberId: input.memberId,
      expectedMembershipVersion: input.expectedMembershipVersion,
    });

    return this.dependencies.unitOfWork.transact<MemberLifecycleCommandResult>(
      (state) => {
        if (state.household.householdId !== input.householdId) {
          return {
            state,
            value: { kind: "conflict", code: "HOUSEHOLD_SCOPE_MISMATCH" },
          };
        }
        const prior = state.receipts.find(
          (receipt) => receipt.idempotencyKey === input.idempotencyKey,
        );
        if (prior !== undefined) {
          return {
            state,
            value:
              prior.payloadFingerprint === payloadFingerprint
                ? prior.result
                : {
                    kind: "conflict",
                    code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
                  },
          };
        }

        const membership = lifecycleMembership(state, input.memberId);
        const member = state.members.find(
          (candidate) => candidate.memberId === input.memberId,
        );
        const profile = state.memberOwnerProfiles.find(
          (candidate) => candidate.linkedMemberId === input.memberId,
        );
        if (membership === undefined || member === undefined || profile === undefined) {
          return {
            state,
            value: { kind: "conflict", code: "MEMBER_NOT_FOUND" },
          };
        }
        if (membership.status === "active") {
          const result: StoredMemberLifecycleResult = {
            kind: "already-processed",
            memberId: input.memberId,
            membershipVersion: membership.version,
          };
          return {
            state: {
              ...state,
              receipts: [
                ...state.receipts,
                { idempotencyKey: input.idempotencyKey, payloadFingerprint, result },
              ],
            },
            value: result,
          };
        }
        if (membership.version !== input.expectedMembershipVersion) {
          return {
            state,
            value: { kind: "conflict", code: "VERSION_MISMATCH" },
          };
        }
        const existingClaim = state.principalClaims.find(
          (claim) => claim.principalUid === membership.principalUid,
        );
        if (existingClaim !== undefined) {
          return {
            state,
            value: { kind: "conflict", code: "PRINCIPAL_ALREADY_JOINED" },
          };
        }

        const nextVersion = membership.version + 1;
        const result: StoredMemberLifecycleResult = {
          kind: "success",
          memberId: input.memberId,
          membershipStatus: "active",
          membershipVersion: nextVersion,
        };
        const receipt: MemberLifecycleReceipt = {
          idempotencyKey: input.idempotencyKey,
          payloadFingerprint,
          result,
        };
        return {
          state: {
            ...state,
            members: state.members.map((candidate) =>
              candidate.memberId === input.memberId
                ? { ...candidate, status: "active", version: nextVersion }
                : candidate,
            ),
            memberships: state.memberships.map((candidate) =>
              candidate.memberId === input.memberId &&
              candidate.householdId === input.householdId
                ? { ...candidate, status: "active", version: nextVersion }
                : candidate,
            ),
            memberOwnerProfiles: state.memberOwnerProfiles.map((candidate) =>
              candidate.linkedMemberId === input.memberId
                ? { ...candidate, lifecycleState: "active" }
                : candidate,
            ),
            principalClaims: [
              ...state.principalClaims,
              {
                principalUid: membership.principalUid,
                householdId: input.householdId,
                memberId: input.memberId,
              },
            ],
            receipts: [...state.receipts, receipt],
            events: [
              ...state.events,
              memberLifecycleEvent({
                operation: "restore",
                householdId: input.householdId,
                memberId: input.memberId,
                membershipVersion: nextVersion,
              }),
            ],
          },
          value: result,
        };
      },
    );
  }

  async authorizeMember(memberId: string): Promise<"allowed" | "forbidden"> {
    const state = await this.dependencies.unitOfWork.read();
    const membership = lifecycleMembership(state, memberId);
    return membership?.status === "active" ? "allowed" : "forbidden";
  }
}

export function createMemberLifecycleApplication(
  dependencies: MemberLifecycleApplicationDependencies,
): MemberLifecycleInputPort {
  return new DefaultMemberLifecycleApplication(dependencies);
}
