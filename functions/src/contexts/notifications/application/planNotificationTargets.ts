import {
  HouseholdNotificationRequestedInput,
  NotificationTargetDecision,
  RecipientPolicyDecision,
  TransactionRecordedNotificationInput,
} from "../domain/model/notificationTarget";
import { expandRecipientsToActiveEndpoints } from "../domain/policies/activeEndpointFanoutPolicy";
import { decideHouseholdRequestRecipients } from "../domain/policies/householdNotificationRequestPolicy";
import { decideTransactionCreatedRecipients } from "../domain/policies/transactionCreatedNotificationPolicy";

function finishPlanning(
  input: {
    householdId: string;
    transactionId: string;
    members: TransactionRecordedNotificationInput["members"];
    endpoints: TransactionRecordedNotificationInput["endpoints"];
  },
  decision: RecipientPolicyDecision,
): NotificationTargetDecision {
  if (decision.kind !== "RecipientMembers") {
    return decision;
  }

  return expandRecipientsToActiveEndpoints({
    householdId: input.householdId,
    transactionId: input.transactionId,
    members: input.members,
    endpoints: input.endpoints,
    directive: decision,
  });
}

export interface NotificationTargetPlanner {
  forRecordedTransaction(
    input: TransactionRecordedNotificationInput,
  ): NotificationTargetDecision;
  forExplicitHouseholdRequest(
    input: HouseholdNotificationRequestedInput,
  ): NotificationTargetDecision;
}

class DefaultNotificationTargetPlanner implements NotificationTargetPlanner {
  forRecordedTransaction(
    input: TransactionRecordedNotificationInput,
  ): NotificationTargetDecision {
    return finishPlanning(input, decideTransactionCreatedRecipients(input));
  }

  forExplicitHouseholdRequest(
    input: HouseholdNotificationRequestedInput,
  ): NotificationTargetDecision {
    return finishPlanning(
      input,
      decideHouseholdRequestRecipients(input, input.members),
    );
  }
}

export function createDefaultNotificationTargetPlanner(): NotificationTargetPlanner {
  return new DefaultNotificationTargetPlanner();
}
