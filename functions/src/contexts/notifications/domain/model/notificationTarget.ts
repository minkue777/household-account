export type MobileEndpointPlatform = "android" | "ios-pwa";

export const NOTIFICATION_PAYLOAD_VERSION = "notification-payload.v1" as const;

export interface MemberFact {
  householdId: string;
  memberId: string;
  status: "active" | "removed" | "deleted";
}

export interface EndpointFact {
  endpointId: string;
  householdId: string;
  memberId: string;
  platform: MobileEndpointPlatform;
  status: "active" | "inactive";
}

export type NotificationIntentType =
  | "expense-created"
  | "household-notification-requested";

export interface NotificationTarget {
  recipientMemberId: string;
  endpointId: string;
  platform: MobileEndpointPlatform;
  payload: {
    payloadVersion: typeof NOTIFICATION_PAYLOAD_VERSION;
    type: NotificationIntentType;
    clickTarget: "expense-edit";
    expenseId: string;
  };
}

export type NotificationTargetDecision =
  | {
      kind: "Recipients";
      targets: readonly NotificationTarget[];
    }
  | {
      kind: "NoTarget";
      reason:
        | "ANDROID_USES_QUICK_EDIT"
        | "AUTO_PUSH_NOT_ALLOWED_FOR_CHANNEL"
        | "NO_OTHER_HOUSEHOLD_MEMBER"
        | "NO_ACTIVE_ENDPOINT";
    }
  | {
      kind: "ContractFailure";
      code:
        | "CREATOR_MEMBER_REQUIRED"
        | "UNKNOWN_ORIGIN_CHANNEL"
        | "REQUESTER_MEMBER_REQUIRED";
    };

export interface TransactionRecordedNotificationInput {
  eventId: string;
  householdId: string;
  transactionId: string;
  transactionType: "expense";
  originChannel: string;
  creatorMemberId?: string;
  members: readonly MemberFact[];
  endpoints: readonly EndpointFact[];
}

export interface HouseholdNotificationRequestedInput {
  eventId: string;
  householdId: string;
  transactionId: string;
  creatorMemberId: string;
  requesterMemberId?: string;
  members: readonly MemberFact[];
  endpoints: readonly EndpointFact[];
}

export type EndpointPlatformConstraint = MobileEndpointPlatform | "all-mobile";

export interface RecipientDirective {
  kind: "RecipientMembers";
  recipientMemberIds: readonly string[];
  endpointPlatform: EndpointPlatformConstraint;
  intentType: NotificationIntentType;
}

export type RecipientPolicyDecision =
  | RecipientDirective
  | Exclude<NotificationTargetDecision, { kind: "Recipients" }>;
