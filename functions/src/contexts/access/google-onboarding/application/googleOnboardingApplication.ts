import {
  CreateHouseholdResult,
  CreateInvitationResult,
  JoinHouseholdResult,
  VerifiedGooglePrincipal,
} from "./ports/in/googleOnboardingInputPort";
import {
  GoogleOnboardingClockPort,
  GoogleOnboardingIdentityPort,
  GoogleOnboardingStorePort,
  HouseholdInitializationStorePort,
  HouseholdInitializationPort,
  InvitationSecurityPort,
} from "./ports/out/googleOnboardingStorePort";
import {
  GoogleOnboardingState,
  OnboardingMembership,
} from "../domain/model/googleOnboarding";
import {
  invitationCanBeUsed,
  invitationExpiresAt,
  membershipView,
  STANDARD_MEMBER_CAPABILITIES,
  validateCreateSelfInput,
  validateJoinSelfInput,
} from "../domain/policies/googleOnboardingPolicy";

interface CreateHouseholdDependencies {
  store: GoogleOnboardingStorePort & HouseholdInitializationStorePort;
  identities: GoogleOnboardingIdentityPort;
  initializer: HouseholdInitializationPort;
}

interface CreateInvitationDependencies {
  store: GoogleOnboardingStorePort;
  clock: GoogleOnboardingClockPort;
  invitations: InvitationSecurityPort;
}

interface JoinHouseholdDependencies {
  store: GoogleOnboardingStorePort;
  clock: GoogleOnboardingClockPort;
  identities: Pick<GoogleOnboardingIdentityPort, "nextMemberId">;
  invitations: Pick<InvitationSecurityPort, "hashCode">;
}

function principalHasClaim(
  state: GoogleOnboardingState,
  principalUid: string,
): boolean {
  return state.principalClaims.some(
    (claim) => claim.principalUid === principalUid,
  );
}


export async function createHouseholdWithSelf(
  dependencies: CreateHouseholdDependencies,
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

  const committed = await dependencies.store.transact<
    CreateHouseholdResult
  >((current) => {
    if (principalHasClaim(current, principal.uid)) {
      return {
        state: current,
        value: { kind: "conflict", code: "PRINCIPAL_ALREADY_JOINED" },
      };
    }

    const householdId = dependencies.identities.nextHouseholdId(
      input.idempotencyKey,
    );
    const memberId = dependencies.identities.nextMemberId(
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

  const initializationStatus = await dependencies.initializer.initialize(
    committed.householdId,
  );
  const finalStatus = await dependencies.store.finalizeInitialization(
    committed.householdId, initializationStatus,
  );

  return { ...committed, initializationStatus: finalStatus };
}

export async function createInvitationCode(
  dependencies: CreateInvitationDependencies,
  principal: VerifiedGooglePrincipal,
  input: { householdId: string; idempotencyKey: string },
): Promise<CreateInvitationResult> {
  return dependencies.store.transact<CreateInvitationResult>((current) => {
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

    const invitationCode = dependencies.invitations.issueCode(
      input.idempotencyKey,
    );
    const expiresAt = invitationExpiresAt(dependencies.clock.now());
    return {
      state: {
        ...current,
        invitations: [
          ...current.invitations,
          {
            invitationHash:
              dependencies.invitations.hashCode(invitationCode),
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

export async function joinHouseholdAsSelf(
  dependencies: JoinHouseholdDependencies,
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
  const invitationHash = dependencies.invitations.hashCode(
    input.invitationCode.trim(),
  );

  return dependencies.store.transact<JoinHouseholdResult>((current) => {
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
        now: dependencies.clock.now(),
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

    const memberId = dependencies.identities.nextMemberId(
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
