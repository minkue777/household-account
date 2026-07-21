import type {
  ClientSessionScope,
  NativeSessionMirror,
  SessionMembershipState,
} from "../model/sessionMembership";

export const SUPPORTED_USER_ACCESS_COMMANDS = [
  "CreateHouseholdWithSelf",
  "CreateInvitationCode",
  "JoinHouseholdAsSelf",
  "RenameSelf",
  "LogoutHouseholdSession",
  "RestoreSignedInSession",
  "RequestHouseholdDeletion",
] as const;

export function resolveRetainedMembership(
  state: SessionMembershipState,
  principalUid: string,
):
  | {
      session: ClientSessionScope;
      bridgeMirror: NativeSessionMirror;
      generation: number;
    }
  | undefined {
  if (
    state.household.lifecycleState !== "active" ||
    state.membership.status !== "active" ||
    state.member.status !== "active" ||
    state.membership.principalUid !== principalUid ||
    state.membership.householdId !== state.household.householdId ||
    state.membership.memberId !== state.member.memberId
  ) {
    return undefined;
  }

  const generation = state.lastSessionGeneration + 1;
  return {
    generation,
    session: {
      schemaVersion: "session-scope.v1",
      sessionGeneration: generation,
      principalUid,
      householdId: state.household.householdId,
      actingMemberId: state.member.memberId,
      displayName: state.member.displayName,
    },
    bridgeMirror: {
      householdId: state.household.householdId,
      memberId: state.member.memberId,
      sessionGeneration: generation,
    },
  };
}

export function isCurrentSessionGeneration(
  state: SessionMembershipState,
  generation: number,
): boolean {
  return state.session?.sessionGeneration === generation;
}
