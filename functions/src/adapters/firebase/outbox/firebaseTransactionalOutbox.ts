import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

const PRODUCER_BY_EVENT = Object.freeze({
  "TransactionRecorded.v1": "household-finance.ledger",
  "TransactionChanged.v1": "household-finance.ledger",
  "TransactionDeleted.v1": "household-finance.ledger",
  "HouseholdNotificationRequested.v1": "household-finance.ledger",
  "MemberRenamed.v1": "access.member-rename",
  "HouseholdMemberRemoved.v1": "access.member-lifecycle",
  "HouseholdMemberRestored.v1": "access.member-lifecycle",
  "HouseholdCreated.v1": "access.google-onboarding",
  "MemberJoined.v1": "access.google-onboarding",
  "LegacyMembershipClaimed.v1": "access.legacy-membership",
  "AssetOwnerProfileChanged.v1": "access.asset-owner-profile",
  "HouseholdDeleted.v1": "access.household-lifecycle",
  "HouseholdRestored.v1": "access.household-lifecycle",
  "HomeConfigurationChanged.v1": "home-preferences",
  "CategoryCatalogChanged.v1": "household-finance.categories-budget",
  "RecurringPlanChanged.v1": "household-finance.recurring",
  "RecurringPlanProcessed.v1": "household-finance.recurring",
  "AssetValuationChanged.v1": "portfolio.core",
  "AssetLifecycleChanged.v1": "portfolio.core",
  "PositionChanged.v1": "portfolio.holdings",
  "AssetAutomationApplied.v1": "portfolio.automation",
  "DividendEventChanged.v1": "portfolio.dividends",
  "DividendEventRemoved.v1": "portfolio.dividends",
} as const);

type RegisteredEventType = keyof typeof PRODUCER_BY_EVENT;

export interface FirebaseOutboxAppendInput {
  readonly eventId: string;
  readonly eventType: RegisteredEventType;
  readonly householdId: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export class FirebaseTransactionalOutbox {
  constructor(private readonly database: firestore.Firestore) {}

  append(
    transaction: firestore.Transaction,
    input: FirebaseOutboxAppendInput,
  ): void {
    const match = /^(.*)\.v([1-9][0-9]*)$/u.exec(input.eventType);
    if (match === null) throw new Error(`Invalid event type: ${input.eventType}`);
    const reference = this.database.collection("outboxEvents").doc(input.eventId);
    transaction.create(reference, {
      eventId: input.eventId,
      eventType: match[1],
      eventVersion: Number(match[2]),
      producerContext: PRODUCER_BY_EVENT[input.eventType],
      householdId: input.householdId,
      aggregateId: input.aggregateId,
      aggregateVersion: input.aggregateVersion,
      occurredAt: input.occurredAt,
      correlationId: input.correlationId,
      causationId: input.causationId,
      payload: input.payload,
      status: "pending",
      schemaVersion: 1,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
}
