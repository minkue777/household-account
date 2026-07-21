import {
  ClaimLegacySessionResult,
  LegacyMembershipView,
  LegacySessionCandidate,
  RepairLegacyMembershipResult,
  ResolveLegacyUserResult,
  VerifiedLegacyRecoveryOperator,
} from "./ports/in/legacyMembershipInputPort";
import {
  LegacyMemberOwnerProfileIdPort,
  LegacyMembershipStorePort,
} from "./ports/out/legacyMembershipStorePort";
import {
  LegacyMember,
  LegacyMembership,
  LegacyMembershipState,
} from "../domain/model/legacyMembership";
import { resolveLegacyCandidateTarget } from "../domain/policies/legacyMembershipPolicy";
import { findActiveMembership } from "../../membership/domain/model/accessMembership";

export interface LegacyMembershipApplicationDependencies {
  store: LegacyMembershipStorePort;
  profileIds: LegacyMemberOwnerProfileIdPort;
}

export interface LegacyMembershipUseCases {
  resolveSignedInUser(
    principalUid: string,
    candidate: LegacySessionCandidate | undefined,
  ): Promise<ResolveLegacyUserResult>;
  claimLegacySession(input: {
    principalUid: string;
    candidate: LegacySessionCandidate;
    userConfirmed: true;
    idempotencyKey: string;
  }): Promise<ClaimLegacySessionResult>;
  repairLegacyMembershipClaim(
    operator: VerifiedLegacyRecoveryOperator,
    input: {
      principalUid: string;
      householdId: string;
      memberId: string;
      reason: string;
      idempotencyKey: string;
    },
  ): Promise<RepairLegacyMembershipResult>;
}

function membershipView(membership: LegacyMembership): LegacyMembershipView {
  return { ...membership };
}

function linkedResult(
  kind: "membership-linked" | "already-linked",
  membership: LegacyMembership,
): ClaimLegacySessionResult {
  return {
    kind,
    membership: membershipView(membership),
    session: {
      householdId: membership.householdId,
      actingMemberId: membership.memberId,
      principalUid: membership.principalUid,
    },
  };
}

function ensureMemberOwnerProfile(
  state: LegacyMembershipState,
  member: LegacyMember,
  profileIds: LegacyMemberOwnerProfileIdPort,
): LegacyMembershipState["memberOwnerProfiles"] {
  const exists = state.memberOwnerProfiles.some(
    (profile) =>
      profile.householdId === member.householdId &&
      profile.linkedMemberId === member.memberId,
  );
  return exists
    ? state.memberOwnerProfiles
    : [
        ...state.memberOwnerProfiles,
        {
          householdId: member.householdId,
          profileId: profileIds.profileIdForMember(
            member.householdId,
            member.memberId,
          ),
          linkedMemberId: member.memberId,
          lifecycleState: "active" as const,
        },
      ];
}

class DefaultLegacyMembershipApplication implements LegacyMembershipUseCases {
  constructor(private readonly dependencies: LegacyMembershipApplicationDependencies) {}

  async resolveSignedInUser(
    principalUid: string,
    candidate: LegacySessionCandidate | undefined,
  ): Promise<ResolveLegacyUserResult> {
    const read = await this.dependencies.store.readForResolution();
    if (read.kind !== "success") {
      return read;
    }
    const membership = findActiveMembership(
      read.state.memberships,
      principalUid,
    );
    if (membership !== undefined) {
      return {
        kind: "membership-found",
        membership: membershipView(membership),
      };
    }
    if (
      candidate !== undefined &&
      resolveLegacyCandidateTarget(read.state, candidate) !== undefined
    ) {
      return { kind: "legacy-confirmation-required", candidate };
    }
    return { kind: "first-visit-required", choices: ["create", "join"] };
  }

  async claimLegacySession(input: {
    principalUid: string;
    candidate: LegacySessionCandidate;
    userConfirmed: true;
    idempotencyKey: string;
  }): Promise<ClaimLegacySessionResult> {
    return this.dependencies.store.transact<ClaimLegacySessionResult>(
      (current) => {
        const existingMembership = current.memberships.find(
          (membership) => membership.principalUid === input.principalUid,
        );
        const target = resolveLegacyCandidateTarget(current, input.candidate);

        if (existingMembership !== undefined) {
          if (
            target !== undefined &&
            existingMembership.householdId === target.household.householdId &&
            existingMembership.memberId === target.member.memberId &&
            target.member.linkedPrincipalUid === input.principalUid
          ) {
            return {
              state: current,
              value: linkedResult("already-linked", existingMembership),
            };
          }
          return {
            state: current,
            value: { kind: "conflict", code: "PRINCIPAL_ALREADY_JOINED" },
          };
        }
        if (target === undefined) {
          return { state: current, value: { kind: "first-visit-required" } };
        }
        if (
          target.member.linkedPrincipalUid !== undefined &&
          target.member.linkedPrincipalUid !== input.principalUid
        ) {
          return {
            state: current,
            value: { kind: "conflict", code: "MEMBER_ALREADY_LINKED" },
          };
        }

        const membership: LegacyMembership = {
          householdId: target.household.householdId,
          memberId: target.member.memberId,
          principalUid: input.principalUid,
          status: "active",
        };
        const linkedMember: LegacyMember = {
          ...target.member,
          linkedPrincipalUid: input.principalUid,
        };
        return {
          state: {
            ...current,
            members: current.members.map((member) =>
              member.householdId === linkedMember.householdId &&
              member.memberId === linkedMember.memberId
                ? linkedMember
                : member,
            ),
            memberships: [...current.memberships, membership],
            memberOwnerProfiles: ensureMemberOwnerProfile(
              current,
              linkedMember,
              this.dependencies.profileIds,
            ),
            auditEvents: [
              ...current.auditEvents,
              {
                eventType: "LegacyMembershipClaimed.v1",
                householdId: linkedMember.householdId,
                memberId: linkedMember.memberId,
              },
            ],
          },
          value: linkedResult("membership-linked", membership),
        };
      },
    );
  }

  async repairLegacyMembershipClaim(
    operator: VerifiedLegacyRecoveryOperator,
    input: {
      principalUid: string;
      householdId: string;
      memberId: string;
      reason: string;
      idempotencyKey: string;
    },
  ): Promise<RepairLegacyMembershipResult> {
    if (!operator.capabilities.includes("admin.membership-claims.repair")) {
      return { kind: "forbidden", code: "RECOVERY_CAPABILITY_REQUIRED" };
    }

    return this.dependencies.store.transact<RepairLegacyMembershipResult>(
      (current) => {
        const household = current.households.find(
          (item) =>
            item.householdId === input.householdId &&
            item.lifecycleState === "active",
        );
        const member = current.members.find(
          (item) =>
            item.householdId === input.householdId &&
            item.memberId === input.memberId,
        );
        if (household === undefined || member === undefined) {
          return {
            state: current,
            value: {
              kind: "not-found",
              code: "HOUSEHOLD_OR_MEMBER_NOT_FOUND",
            },
          };
        }

        const principalMembership = current.memberships.find(
          (membership) => membership.principalUid === input.principalUid,
        );
        if (
          principalMembership !== undefined &&
          (principalMembership.householdId !== input.householdId ||
            principalMembership.memberId !== input.memberId)
        ) {
          return {
            state: current,
            value: { kind: "conflict", code: "PRINCIPAL_ALREADY_JOINED" },
          };
        }
        if (
          member.linkedPrincipalUid !== undefined &&
          member.linkedPrincipalUid !== input.principalUid
        ) {
          return {
            state: current,
            value: { kind: "conflict", code: "MEMBER_ALREADY_LINKED" },
          };
        }

        const membership: LegacyMembership =
          principalMembership ?? {
            householdId: input.householdId,
            memberId: input.memberId,
            principalUid: input.principalUid,
            status: "active",
          };
        const linkedMember: LegacyMember = {
          ...member,
          linkedPrincipalUid: input.principalUid,
        };
        return {
          state: {
            ...current,
            members: current.members.map((item) =>
              item.householdId === linkedMember.householdId &&
              item.memberId === linkedMember.memberId
                ? linkedMember
                : item,
            ),
            memberships:
              principalMembership === undefined
                ? [...current.memberships, membership]
                : current.memberships,
            memberOwnerProfiles: ensureMemberOwnerProfile(
              current,
              linkedMember,
              this.dependencies.profileIds,
            ),
            auditEvents: [
              ...current.auditEvents,
              {
                eventType: "LegacyMembershipClaimRepaired.v1",
                householdId: input.householdId,
                memberId: input.memberId,
              },
            ],
          },
          value: { kind: "repaired", membership: membershipView(membership) },
        };
      },
    );
  }
}

export function createLegacyMembershipApplication(
  dependencies: LegacyMembershipApplicationDependencies,
): LegacyMembershipUseCases {
  return new DefaultLegacyMembershipApplication(dependencies);
}
