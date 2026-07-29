import { onDocumentCreated } from "firebase-functions/v2/firestore";

import { db, messaging, REGION } from "../config";
import { createDeliveryAssuranceApplication } from "../contexts/notifications/application/deliveryAssuranceApplication";
import { createShortcutTransactionNotificationConsumer } from "../contexts/notifications/application/shortcutTransactionNotificationConsumer";
import { createNotificationTargetPlanner } from "../contexts/notifications/public";
import {
  FirebaseDeliveryAssuranceStore,
  FirebaseDeliveryMembershipQuery,
  FirebaseFidDeliveryProvider,
  FirebaseShortcutFidProvider,
  FirebaseShortcutNotificationFactsQuery,
  FirebaseShortcutTransactionNotificationStore,
} from "../adapters/firebase/notifications/firebaseNotificationDeliveryAdapters";
import { firestoreTtlAfter } from "../adapters/firebase/shared/firestoreTtl";
import {
  correlationIdFromOpaqueValue,
  setCurrentInteractiveLatencyOperation,
  startInteractiveLatencyInvocation,
  type InteractiveLatencyStatus,
} from "../observability/interactiveLatency";
import {
  HOUSEHOLD_NOTIFICATION_DELIVERY_OPERATION,
  householdNotificationDeliveryLatencyStatus,
  SHORTCUT_NOTIFICATION_DELIVERY_OPERATION,
  shortcutNotificationDeliveryLatencyStatus,
} from "./notificationOutboxLatency";

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function versionedEventType(data: Record<string, unknown>): string {
  const eventType = text(data.eventType);
  const version = data.eventVersion;
  if (eventType === undefined || !Number.isSafeInteger(version)) {
    throw new Error("OUTBOX_EVENT_TYPE_INVALID");
  }
  return `${eventType}.v${String(version)}`;
}

const deliveryApplication = createDeliveryAssuranceApplication(
  createNotificationTargetPlanner(),
  new FirebaseDeliveryMembershipQuery(db),
  new FirebaseDeliveryAssuranceStore(db),
  new FirebaseFidDeliveryProvider(messaging),
  { now: () => new Date().toISOString() },
);

const shortcutApplication = createShortcutTransactionNotificationConsumer(
  createNotificationTargetPlanner(),
  new FirebaseShortcutNotificationFactsQuery(db),
  new FirebaseShortcutTransactionNotificationStore(db),
  new FirebaseShortcutFidProvider(messaging),
);

export const consumeNotificationOutbox = onDocumentCreated(
  {
    document: "outboxEvents/{eventId}",
    region: REGION,
    retry: true,
    timeoutSeconds: 120,
  },
  async (event) => {
    const snapshot = event.data;
    if (snapshot === undefined) return;
    const data = record(snapshot.data());
    const payload = record(data.payload);
    const eventType = versionedEventType(data);
    const isHouseholdNotification =
      eventType === "HouseholdNotificationRequested.v1";
    const isShortcutNotification =
      eventType === "TransactionRecorded.v1" &&
      text(payload.originChannel) === "ios-shortcut";
    if (!isHouseholdNotification && !isShortcutNotification) return;

    const eventId = text(data.eventId) ?? event.params.eventId;
    const latency = startInteractiveLatencyInvocation(
      "consumeNotificationOutbox",
      {
        correlationId: correlationIdFromOpaqueValue(eventId),
        // Firestore trigger가 배정되기 전의 대기까지 FCM 접수 total에 포함합니다.
        elapsedBeforeInvocationMs: Math.max(
          0,
          Date.now() - snapshot.createTime.toMillis(),
        ),
      },
    );

    return latency.run(async () => {
      setCurrentInteractiveLatencyOperation(
        isHouseholdNotification
          ? HOUSEHOLD_NOTIFICATION_DELIVERY_OPERATION
          : SHORTCUT_NOTIFICATION_DELIVERY_OPERATION,
      );
      try {
        const householdId = text(data.householdId);
        const occurredAt = text(data.occurredAt);
        if (householdId === undefined || occurredAt === undefined) {
          throw new Error("OUTBOX_EVENT_ENVELOPE_INVALID");
        }

        if (isHouseholdNotification) {
          const transactionId =
            text(payload.transactionId) ?? text(data.aggregateId);
          const requesterMemberId = text(payload.requesterMemberId);
          if (transactionId === undefined || requesterMemberId === undefined) {
            throw new Error("NOTIFICATION_REQUEST_EVENT_INVALID");
          }
          const accepted = await deliveryApplication.accept({
            eventId,
            eventType: "HouseholdNotificationRequested.v1",
            producer: "household-finance.ledger",
            occurredAt,
            householdId,
            transactionId,
            requesterMemberId,
          });
          if (accepted.kind === "RetryableFailure") {
            throw new Error(accepted.code);
          }

          let status: InteractiveLatencyStatus;
          if (
            accepted.kind === "Queued" ||
            accepted.kind === "AlreadyProcessed"
          ) {
            const deliveryResults = await Promise.all(
              accepted.deliveryIds.map((deliveryId) =>
                deliveryApplication.deliver(deliveryId),
              ),
            );
            await deliveryApplication.completeIntent(accepted.intentId);
            status = householdNotificationDeliveryLatencyStatus({
              kind: accepted.kind,
              deliveryResults,
            });
          } else {
            status = householdNotificationDeliveryLatencyStatus({
              kind: accepted.kind,
            });
          }

          const terminalAt = new Date().toISOString();
          await snapshot.ref.set(
            {
              notificationConsumerStatus: "processed",
              notificationConsumerProcessedAt: terminalAt,
              terminalAt,
              expiresAt: firestoreTtlAfter(terminalAt),
            },
            { merge: true },
          );
          latency.complete(status);
          return;
        }

        const transactionId =
          text(payload.transactionId) ?? text(data.aggregateId);
        const creatorMemberId = text(payload.creatorMemberId);
        if (transactionId === undefined || creatorMemberId === undefined) {
          throw new Error("SHORTCUT_TRANSACTION_EVENT_INVALID");
        }
        const result = await shortcutApplication.consume({
          eventId,
          eventType: "TransactionRecorded.v1",
          producer: "payment-capture.shortcut-ingestion",
          householdId,
          transactionId,
          creatorMemberId,
          originChannel: "ios-shortcut",
        });
        const terminalAt = new Date().toISOString();
        await snapshot.ref.set(
          {
            notificationConsumerStatus: result.kind,
            notificationConsumerProcessedAt: terminalAt,
            terminalAt,
            expiresAt: firestoreTtlAfter(terminalAt),
          },
          { merge: true },
        );
        latency.complete(shortcutNotificationDeliveryLatencyStatus(result));
      } catch (error) {
        latency.complete("failed");
        throw error;
      }
    });
  },
);
