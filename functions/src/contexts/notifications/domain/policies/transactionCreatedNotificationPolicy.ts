import {
  RecipientPolicyDecision,
  TransactionRecordedNotificationInput,
} from "../model/notificationTarget";

const NON_PUSH_ORIGIN_CHANNELS = new Set([
  "web-manual",
  "recurring",
  "system",
]);

export function decideTransactionCreatedRecipients(
  input: Pick<
    TransactionRecordedNotificationInput,
    "originChannel" | "creatorMemberId"
  >,
): RecipientPolicyDecision {
  if (input.creatorMemberId === undefined || input.creatorMemberId.length === 0) {
    return { kind: "ContractFailure", code: "CREATOR_MEMBER_REQUIRED" };
  }

  if (input.originChannel === "android-notification") {
    return { kind: "NoTarget", reason: "ANDROID_USES_QUICK_EDIT" };
  }

  if (input.originChannel === "ios-shortcut") {
    return {
      kind: "RecipientMembers",
      recipientMemberIds: [input.creatorMemberId],
      endpointPlatform: "ios-pwa",
      intentType: "expense-created",
    };
  }

  if (NON_PUSH_ORIGIN_CHANNELS.has(input.originChannel)) {
    return {
      kind: "NoTarget",
      reason: "AUTO_PUSH_NOT_ALLOWED_FOR_CHANNEL",
    };
  }

  return { kind: "ContractFailure", code: "UNKNOWN_ORIGIN_CHANNEL" };
}
