import {
  EndpointFact,
  MemberFact,
  NOTIFICATION_PAYLOAD_VERSION,
  NotificationTarget,
  NotificationTargetDecision,
  RecipientDirective,
} from "../model/notificationTarget";

export function expandRecipientsToActiveEndpoints(input: {
  householdId: string;
  transactionId: string;
  directive: RecipientDirective;
  members: readonly MemberFact[];
  endpoints: readonly EndpointFact[];
}): NotificationTargetDecision {
  const requestedMembers = new Set(input.directive.recipientMemberIds);
  const activeMembers = new Set(
    input.members
      .filter(
        (member) =>
          member.householdId === input.householdId &&
          member.status === "active" &&
          requestedMembers.has(member.memberId),
      )
      .map((member) => member.memberId),
  );

  const uniqueEligibleEndpoints = new Map<string, EndpointFact>();
  for (const endpoint of input.endpoints) {
    if (
      endpoint.householdId !== input.householdId ||
      endpoint.status !== "active" ||
      !activeMembers.has(endpoint.memberId) ||
      (input.directive.endpointPlatform !== "all-mobile" &&
        endpoint.platform !== input.directive.endpointPlatform)
    ) {
      continue;
    }
    if (!uniqueEligibleEndpoints.has(endpoint.endpointId)) {
      uniqueEligibleEndpoints.set(endpoint.endpointId, endpoint);
    }
  }

  const targets: NotificationTarget[] = Array.from(
    uniqueEligibleEndpoints.values(),
  )
    .sort((left, right) => left.endpointId.localeCompare(right.endpointId))
    .map((endpoint) => ({
      recipientMemberId: endpoint.memberId,
      endpointId: endpoint.endpointId,
      platform: endpoint.platform,
      payload: {
        payloadVersion: NOTIFICATION_PAYLOAD_VERSION,
        type: input.directive.intentType,
        clickTarget: "expense-edit",
        expenseId: input.transactionId,
      },
    }));

  if (targets.length === 0) {
    return { kind: "NoTarget", reason: "NO_ACTIVE_ENDPOINT" };
  }

  return { kind: "Recipients", targets };
}
