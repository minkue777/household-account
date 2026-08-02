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
  notificationOutboxConsumerAlreadyTerminal,
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
    // provider 결과가 확정된 뒤에는 같은 알림을 다시 보내지 않되, FCM 호출 전
    // Firestore 같은 기반 시설의 일시 장애는 기존 trigger 재시도로 복구합니다.
    // NoTarget과 영구 실패는 typed terminal 결과로 반환하므로 재시도되지 않습니다.
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

    // Firestore/Eventarc는 같은 created event를 다시 전달할 수 있습니다.
    // live 문서가 이미 terminal이면 과거 snapshot을 재처리해 뒤늦은 FCM을
    // 보내거나 동일 지연 표본을 다시 만드는 일을 막습니다.
    const latestSnapshot = await snapshot.ref.get();
    if (
      latestSnapshot.exists &&
      notificationOutboxConsumerAlreadyTerminal(record(latestSnapshot.data()))
    ) {
      return;
    }

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
