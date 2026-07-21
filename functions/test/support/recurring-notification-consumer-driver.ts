import {
  createNotificationTargetPlanner,
  type EndpointFact,
  type MemberFact,
  type NotificationTargetPlanner,
} from "../../src/contexts/notifications/public";
import { createNotificationSettingsIndependenceFixtureSubject } from "./notification-settings-independence-driver";
import { createRecurringCreatorFixtureSubject } from "./recurring-creator-fixture";

export interface RecurringNotificationEvent {
  eventType: "TransactionRecorded.v1" | "HouseholdNotificationRequested.v1";
  eventId: string;
  householdId: string;
  transactionId: string;
  source?: "recurring";
  originChannel?:
    | "android-notification"
    | "ios-shortcut"
    | "recurring";
  creatorMemberId: string;
  requesterMemberId?: string;
}

export type NotificationConsumerResult =
  | {
      kind: "no-target";
      reason:
        | "ANDROID_USES_QUICK_EDIT"
        | "AUTO_PUSH_NOT_ALLOWED_FOR_CHANNEL";
      eventId: string;
    }
  | {
      kind: "queued";
      eventId: string;
      recipientMemberIds: readonly string[];
    }
  | { kind: "already-processed"; eventId: string };

export interface RecurringNotificationSnapshot {
  ledgerTransactions: readonly {
    transactionId: string;
    source: "recurring";
    creatorMemberId: string;
  }[];
  localQuickEdits: readonly {
    transactionId: string;
    creatorMemberId: string;
    status: "shown" | "suppressed-by-preference";
  }[];
  notificationIntents: readonly {
    sourceEventId: string;
    recipientMemberIds: readonly string[];
  }[];
  notificationDeliveries: readonly {
    recipientMemberId: string;
    endpointId: string;
  }[];
}

export interface RecurringNotificationConsumerFixture {
  members?: readonly MemberFact[];
  endpoints?: readonly EndpointFact[];
}

export interface RecurringNotificationConsumerFixtureSubject {
  processRecurringMonth(input: {
    planId: string;
    targetMonth: string;
  }): Promise<{ kind: "success"; transactionId: string }>;
  recordCapturedTransaction(input: {
    transactionId: string;
    originChannel: "android-notification" | "ios-shortcut";
    creatorMemberId: string;
  }): Promise<{ kind: "success"; eventId: string }>;
  requestHouseholdNotification(input: {
    transactionId: string;
    requesterMemberId: string;
  }): Promise<{ kind: "accepted"; eventId: string }>;
  consumeEvent(eventId: string): Promise<NotificationConsumerResult>;
  snapshot(): Promise<RecurringNotificationSnapshot>;
  publishedEvents(): Promise<readonly RecurringNotificationEvent[]>;
}

const DEFAULT_MEMBERS: readonly MemberFact[] = [
  {
    householdId: "house-1",
    memberId: "member-plan-creator",
    status: "active",
  },
  {
    householdId: "house-1",
    memberId: "member-requester",
    status: "active",
  },
];

const DEFAULT_ENDPOINTS: readonly EndpointFact[] = [
  {
    endpointId: "creator-mobile-endpoint",
    householdId: "house-1",
    memberId: "member-plan-creator",
    platform: "android",
    status: "active",
  },
  {
    endpointId: "requester-mobile-endpoint",
    householdId: "house-1",
    memberId: "member-requester",
    platform: "android",
    status: "active",
  },
];

function cloneEvent(event: RecurringNotificationEvent): RecurringNotificationEvent {
  return { ...event };
}

class RecurringNotificationConsumerFixtureDriver
  implements RecurringNotificationConsumerFixtureSubject
{
  private readonly householdId = "house-1";
  private readonly recurring;
  private readonly planner: NotificationTargetPlanner;
  private readonly androidUx =
    createNotificationSettingsIndependenceFixtureSubject();
  private readonly events: RecurringNotificationEvent[] = [];
  private readonly processedEventIds = new Set<string>();
  private readonly ledgerTransactions: {
    transactionId: string;
    source: "recurring";
    creatorMemberId: string;
  }[] = [];
  private readonly localQuickEdits: {
    transactionId: string;
    creatorMemberId: string;
    status: "shown" | "suppressed-by-preference";
  }[] = [];
  private readonly notificationIntents: {
    sourceEventId: string;
    recipientMemberIds: readonly string[];
  }[] = [];
  private readonly notificationDeliveries: {
    recipientMemberId: string;
    endpointId: string;
  }[] = [];
  private explicitRequestSequence = 1;

  constructor(
    private readonly members: readonly MemberFact[],
    private readonly endpoints: readonly EndpointFact[],
  ) {
    this.planner = createNotificationTargetPlanner();
    this.recurring = createRecurringCreatorFixtureSubject({
      members: members.map(({ householdId, memberId }) => ({
        householdId,
        memberId,
      })),
      legacyPlans: [
        {
          householdId: this.householdId,
          planId: "plan-1",
          creatorMemberId: "member-plan-creator",
          version: 1,
        },
      ],
    });
  }

  async processRecurringMonth(input: {
    planId: string;
    targetMonth: string;
  }): Promise<{ kind: "success"; transactionId: string }> {
    const result = await this.recurring.processMonth({
      householdId: this.householdId,
      planId: input.planId,
      targetMonth: input.targetMonth,
      systemActorId: "recurring-scheduler",
      currentActiveMemberIds: this.members
        .filter(
          (member) =>
            member.householdId === this.householdId &&
            member.status === "active",
        )
        .map((member) => member.memberId),
    });
    if (result.kind !== "created" && result.kind !== "already-processed") {
      throw new Error(`Recurring transaction was not recorded: ${result.kind}`);
    }

    const transaction = result.transaction;
    if (
      !this.ledgerTransactions.some(
        ({ transactionId }) => transactionId === transaction.transactionId,
      )
    ) {
      this.ledgerTransactions.push({
        transactionId: transaction.transactionId,
        source: transaction.source,
        creatorMemberId: transaction.creatorMemberId,
      });
    }

    const eventId = `transaction-recorded:${transaction.transactionId}`;
    if (!this.events.some((event) => event.eventId === eventId)) {
      this.events.push({
        eventType: "TransactionRecorded.v1",
        eventId,
        householdId: this.householdId,
        transactionId: transaction.transactionId,
        source: transaction.source,
        originChannel: "recurring",
        creatorMemberId: transaction.creatorMemberId,
      });
    }
    return { kind: "success", transactionId: transaction.transactionId };
  }

  async recordCapturedTransaction(input: {
    transactionId: string;
    originChannel: "android-notification" | "ios-shortcut";
    creatorMemberId: string;
  }): Promise<{ kind: "success"; eventId: string }> {
    const eventId = `transaction-recorded:${input.transactionId}`;
    this.events.push({
      eventType: "TransactionRecorded.v1",
      eventId,
      householdId: this.householdId,
      transactionId: input.transactionId,
      originChannel: input.originChannel,
      creatorMemberId: input.creatorMemberId,
    });

    if (input.originChannel === "android-notification") {
      const ux = this.androidUx.handleAndroidRecordedTransaction();
      this.localQuickEdits.push({
        transactionId: input.transactionId,
        creatorMemberId: input.creatorMemberId,
        status: ux.localQuickEdit,
      });
    }
    return { kind: "success", eventId };
  }

  async requestHouseholdNotification(input: {
    transactionId: string;
    requesterMemberId: string;
  }): Promise<{ kind: "accepted"; eventId: string }> {
    const transactionEvent = this.events.find(
      (event) =>
        event.eventType === "TransactionRecorded.v1" &&
        event.transactionId === input.transactionId,
    );
    if (transactionEvent === undefined) {
      throw new Error(`Transaction event not found: ${input.transactionId}`);
    }

    const eventId = `household-notification-requested:${this.explicitRequestSequence}`;
    this.explicitRequestSequence += 1;
    this.events.push({
      eventType: "HouseholdNotificationRequested.v1",
      eventId,
      householdId: transactionEvent.householdId,
      transactionId: input.transactionId,
      creatorMemberId: transactionEvent.creatorMemberId,
      requesterMemberId: input.requesterMemberId,
    });
    return { kind: "accepted", eventId };
  }

  async consumeEvent(eventId: string): Promise<NotificationConsumerResult> {
    if (this.processedEventIds.has(eventId)) {
      return { kind: "already-processed", eventId };
    }
    const event = this.events.find((candidate) => candidate.eventId === eventId);
    if (event === undefined) {
      throw new Error(`Notification event not found: ${eventId}`);
    }

    const decision =
      event.eventType === "TransactionRecorded.v1"
        ? this.planner.forRecordedTransaction({
            eventId: event.eventId,
            householdId: event.householdId,
            transactionId: event.transactionId,
            transactionType: "expense",
            originChannel: event.originChannel ?? "",
            creatorMemberId: event.creatorMemberId,
            members: this.members,
            endpoints: this.endpoints,
          })
        : this.planner.forExplicitHouseholdRequest({
            eventId: event.eventId,
            householdId: event.householdId,
            transactionId: event.transactionId,
            creatorMemberId: event.creatorMemberId,
            requesterMemberId: event.requesterMemberId,
            members: this.members,
            endpoints: this.endpoints,
          });

    if (decision.kind === "ContractFailure") {
      throw new Error(`Notification contract failure: ${decision.code}`);
    }

    this.processedEventIds.add(eventId);
    if (decision.kind === "NoTarget") {
      if (
        decision.reason !== "ANDROID_USES_QUICK_EDIT" &&
        decision.reason !== "AUTO_PUSH_NOT_ALLOWED_FOR_CHANNEL"
      ) {
        throw new Error(`Unexpected no-target decision: ${decision.reason}`);
      }
      return { kind: "no-target", reason: decision.reason, eventId };
    }

    const recipientMemberIds = Array.from(
      new Set(decision.targets.map((target) => target.recipientMemberId)),
    ).sort();
    this.notificationIntents.push({
      sourceEventId: eventId,
      recipientMemberIds,
    });
    this.notificationDeliveries.push(
      ...decision.targets.map((target) => ({
        recipientMemberId: target.recipientMemberId,
        endpointId: target.endpointId,
      })),
    );
    return { kind: "queued", eventId, recipientMemberIds };
  }

  async snapshot(): Promise<RecurringNotificationSnapshot> {
    return {
      ledgerTransactions: this.ledgerTransactions.map((transaction) => ({
        ...transaction,
      })),
      localQuickEdits: this.localQuickEdits.map((quickEdit) => ({
        ...quickEdit,
      })),
      notificationIntents: this.notificationIntents.map((intent) => ({
        ...intent,
        recipientMemberIds: [...intent.recipientMemberIds],
      })),
      notificationDeliveries: this.notificationDeliveries.map((delivery) => ({
        ...delivery,
      })),
    };
  }

  async publishedEvents(): Promise<readonly RecurringNotificationEvent[]> {
    return this.events.map(cloneEvent);
  }
}

export function createRecurringNotificationConsumerFixtureSubject(
  fixture: RecurringNotificationConsumerFixture = {},
): RecurringNotificationConsumerFixtureSubject {
  return new RecurringNotificationConsumerFixtureDriver(
    fixture.members ?? DEFAULT_MEMBERS,
    fixture.endpoints ?? DEFAULT_ENDPOINTS,
  );
}
