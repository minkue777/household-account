import {
  CreateHouseholdResult,
  CreateInvitationResult,
  GoogleOnboardingInputPort,
  JoinHouseholdResult,
  ResolveSignedInUserResult,
  VerifiedGooglePrincipal,
} from "./ports/in/googleOnboardingInputPort";
import {
  GoogleOnboardingClockPort,
  GoogleOnboardingIdentityPort,
  GoogleOnboardingStorePort,
  HouseholdInitializationPort,
  InvitationSecurityPort,
} from "./ports/out/googleOnboardingStorePort";
import {
  GoogleOnboardingState,
  OnboardingMembership,
} from "../domain/model/googleOnboarding";
import { findActiveMembership } from "../../membership/domain/model/accessMembership";
import {
  invitationCanBeUsed,
  invitationExpiresAt,
  membershipView,
  STANDARD_MEMBER_CAPABILITIES,
  validateCreateSelfInput,
  validateJoinSelfInput,
} from "../domain/policies/googleOnboardingPolicy";

export interface GoogleOnboardingApplicationDependencies {
  store: GoogleOnboardingStorePort;
  clock: GoogleOnboardingClockPort;
  identities: GoogleOnboardingIdentityPort;
  invitations: InvitationSecurityPort;
  initializer: HouseholdInitializationPort;
}

function principalHasClaim(
  state: GoogleOnboardingState,
  principalUid: string,
): boolean {
  return state.principalClaims.some(
    (claim) => claim.principalUid === principalUid,
  );
}

class DefaultGoogleOnboardingApplication implements GoogleOnboardingInputPort {
  constructor(private readonly dependencies: GoogleOnboardingApplicationDependencies) {}

  async resolveSignedInUser(
    principal: VerifiedGooglePrincipal,
  ): Promise<ResolveSignedInUserResult> {
    const state = await this.dependencies.store.read();
    const membership = findActiveMembership(state.memberships, principal.uid);
    return membership === undefined
      ? { kind: "first-visit-required", choices: ["create", "join"] }
      : { kind: "membership-found", membership: membershipView(membership) };
  }

  async createHouseholdWithSelf(
    principal: VerifiedGooglePrincipal,
    input: {
      householdName: string;
      selfDisplayName: string;
      idempotencyKey: string;
    },
  ): Promise<CreateHouseholdResult> {
    const validation = validateCreateSelfInput(input);
    if (validation.kind === "invalid") {
      return { kind: "validation-error", code: validation.code };
    }

    const committed = await this.dependencies.store.transact<
      CreateHouseholdResult
    >((current) => {
      if (principalHasClaim(current, principal.uid)) {
        return {
          state: current,
          value: { kind: "conflict", code: "PRINCIPAL_ALREADY_JOINED" },
        };
      }

      const householdId = this.dependencies.identities.nextHouseholdId(
        input.idempotencyKey,
      );
      const memberId = this.dependencies.identities.nextMemberId(
        input.idempotencyKey,
      );
      const membership: OnboardingMembership = {
        principalUid: principal.uid,
        householdId,
        memberId,
        status: "active",
        capabilities: [...STANDARD_MEMBER_CAPABILITIES],
      };
      return {
        state: {
          ...current,
          households: [
            ...current.households,
            {
              householdId,
              name: validation.householdName,
              lifecycleState: "active",
            },
          ],
          members: [
            ...current.members,
            {
              householdId,
              memberId,
              linkedPrincipalUid: principal.uid,
              displayName: validation.selfDisplayName,
            },
          ],
          memberships: [...current.memberships, membership],
          principalClaims: [
            ...current.principalClaims,
            {
              principalUid: principal.uid,
              householdId,
              memberId,
              version: 1,
            },
          ],
          initializations: [
            ...current.initializations,
            { householdId, status: "pending" },
          ],
          events: [
            ...current.events,
            {
              eventType: "HouseholdCreated.v1",
              householdId,
              payload: {},
            },
            {
              eventType: "MemberJoined.v1",
              householdId,
              payload: { memberId },
            },
          ],
        },
        value: {
          kind: "success",
          householdId,
          memberId,
          membership: membershipView(membership),
          initializationStatus: "pending",
        },
      };
    });

    if (committed.kind !== "success") {
      return committed;
    }

    const initializationStatus = await this.dependencies.initializer.initialize(
      committed.householdId,
    );
    await this.dependencies.store.transact<void>((current) => ({
      state: {
        ...current,
        initializations: current.initializations.map((initialization) =>
          initialization.householdId === committed.householdId
            ? { ...initialization, status: initializationStatus }
            : initialization,
        ),
      },
      value: undefined,
    }));

    return { ...committed, initializationStatus };
  }

  async createInvitationCode(
    principal: VerifiedGooglePrincipal,
    input: { householdId: string; idempotencyKey: string },
  ): Promise<CreateInvitationResult> {
    return this.dependencies.store.transact<CreateInvitationResult>((current) => {
      const canInvite = current.memberships.some(
        (membership) =>
          membership.principalUid === principal.uid &&
          membership.householdId === input.householdId &&
          membership.status === "active",
      );
      const householdActive = current.households.some(
        (household) =>
          household.householdId === input.householdId &&
          household.lifecycleState === "active",
      );
      if (!canInvite || !householdActive) {
        return {
          state: current,
          value: { kind: "forbidden", code: "INVITATION_ISSUE_FORBIDDEN" },
        };
      }

      const invitationCode = this.dependencies.invitations.issueCode(
        input.idempotencyKey,
      );
      const expiresAt = invitationExpiresAt(this.dependencies.clock.now());
      return {
        state: {
          ...current,
          invitations: [
            ...current.invitations,
            {
              invitationHash:
                this.dependencies.invitations.hashCode(invitationCode),
              householdId: input.householdId,
              expiresAt,
              status: "issued",
            },
          ],
        },
        value: {
          kind: "success",
          invitationCode,
          householdId: input.householdId,
          expiresAt,
        },
      };
    });
  }

  async joinHouseholdAsSelf(
    principal: VerifiedGooglePrincipal,
    input: {
      invitationCode: string;
      selfDisplayName: string;
      idempotencyKey: string;
    },
  ): Promise<JoinHouseholdResult> {
    const validation = validateJoinSelfInput(input);
    if (validation.kind === "invalid") {
      return { kind: "validation-error", code: validation.code };
    }
    const invitationHash = this.dependencies.invitations.hashCode(
      input.invitationCode.trim(),
    );

    return this.dependencies.store.transact<JoinHouseholdResult>((current) => {
      if (principalHasClaim(current, principal.uid)) {
        return {
          state: current,
          value: { kind: "conflict", code: "PRINCIPAL_ALREADY_JOINED" },
        };
      }

      const invitation = current.invitations.find(
        (candidate) => candidate.invitationHash === invitationHash,
      );
      const householdActive = current.households.some(
        (household) =>
          household.householdId === invitation?.householdId &&
          household.lifecycleState === "active",
      );
      if (
        invitation === undefined ||
        !householdActive ||
        !invitationCanBeUsed({
          status: invitation.status,
          expiresAt: invitation.expiresAt,
          now: this.dependencies.clock.now(),
        })
      ) {
        return {
          state: current,
          value: {
            kind: "conflict",
            code: "INVITATION_EXPIRED_OR_USED",
          },
        };
      }

      const memberId = this.dependencies.identities.nextMemberId(
        input.idempotencyKey,
      );
      const membership: OnboardingMembership = {
        principalUid: principal.uid,
        householdId: invitation.householdId,
        memberId,
        status: "active",
        capabilities: [...STANDARD_MEMBER_CAPABILITIES],
      };
      return {
        state: {
          ...current,
          members: [
            ...current.members,
            {
              householdId: invitation.householdId,
              memberId,
              linkedPrincipalUid: principal.uid,
              displayName: validation.selfDisplayName,
            },
          ],
          memberships: [...current.memberships, membership],
          principalClaims: [
            ...current.principalClaims,
            {
              principalUid: principal.uid,
              householdId: invitation.householdId,
              memberId,
              version: 1,
            },
          ],
          invitations: current.invitations.map((candidate) =>
            candidate.invitationHash === invitation.invitationHash
              ? { ...candidate, status: "used", usedByUid: principal.uid }
              : candidate,
          ),
          events: [
            ...current.events,
            {
              eventType: "MemberJoined.v1",
              householdId: invitation.householdId,
              payload: { memberId },
            },
          ],
        },
        value: {
          kind: "success",
          householdId: invitation.householdId,
          memberId,
          membership: membershipView(membership),
        },
      };
    });
  }
}

export function createGoogleOnboardingApplication(
  dependencies: GoogleOnboardingApplicationDependencies,
): GoogleOnboardingInputPort {
  return new DefaultGoogleOnboardingApplication(dependencies);
}
