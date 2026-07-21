import {
  HouseholdNotificationRequestedInput,
  MemberFact,
  RecipientPolicyDecision,
} from "../model/notificationTarget";

export function decideHouseholdRequestRecipients(
  input: Pick<
    HouseholdNotificationRequestedInput,
    "householdId" | "requesterMemberId"
  >,
  members: readonly MemberFact[],
): RecipientPolicyDecision {
  if (
    input.requesterMemberId === undefined ||
    input.requesterMemberId.length === 0
  ) {
    return { kind: "ContractFailure", code: "REQUESTER_MEMBER_REQUIRED" };
  }

  const recipientMemberIds = Array.from(
    new Set(
      members
        .filter(
          (member) =>
            member.householdId === input.householdId &&
            member.status === "active" &&
            member.memberId !== input.requesterMemberId,
        )
        .map((member) => member.memberId),
    ),
  ).sort();

  if (recipientMemberIds.length === 0) {
    return { kind: "NoTarget", reason: "NO_OTHER_HOUSEHOLD_MEMBER" };
  }

  return {
    kind: "RecipientMembers",
    recipientMemberIds,
    endpointPlatform: "all-mobile",
    intentType: "household-notification-requested",
  };
}
