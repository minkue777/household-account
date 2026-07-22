import type { MobileNotificationEndpoint } from "../../../domain/model/mobileNotificationEndpoint";
import type {
  MemberFact,
  NotificationTarget,
} from "../../../domain/model/notificationTarget";

export type ShortcutProviderOutcome =
  | "delivered"
  | "failed"
  | "unknown-provider-outcome"
  | "permanent-failure"
  | "contract-failure";

export interface ShortcutNotificationFacts {
  members: readonly MemberFact[];
  endpoints: readonly MobileNotificationEndpoint[];
}

export interface ShortcutNotificationFactsQuery {
  load(householdId: string): Promise<ShortcutNotificationFacts>;
}

export interface ShortcutDeliveryRecord {
  eventId: string;
  transactionId: string;
  endpointId: string;
  fid: string;
  payload: NotificationTarget["payload"];
  expectedRegistrationVersion: number;
  expectedBindingVersion: number;
  status: "queued" | ShortcutProviderOutcome;
}

export type ShortcutEventClaim =
  | { kind: "claimed"; deliveries: readonly ShortcutDeliveryRecord[] }
  | { kind: "in-progress" }
  | { kind: "completed"; outcome: ShortcutProviderOutcome };

export interface ShortcutTransactionNotificationStore {
  claimEvent(input: {
    eventId: string;
    transactionId: string;
    deliveries: readonly ShortcutDeliveryRecord[];
  }): Promise<ShortcutEventClaim>;
  completeEvent(input: {
    eventId: string;
    outcome: ShortcutProviderOutcome;
    deliveries: readonly ShortcutDeliveryRecord[];
  }): Promise<void>;
  waitForCompletion(eventId: string): Promise<ShortcutProviderOutcome>;
}

export interface ShortcutTransactionNotificationProvider {
  sendOne(input: {
    eventId: string;
    endpointId: string;
    fid: string;
    payload: NotificationTarget["payload"];
  }): Promise<ShortcutProviderOutcome>;
}
