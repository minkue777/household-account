import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { db, messaging, REGION } from "../config";
import { createDeliveryAssuranceApplication } from "../contexts/notifications/application/deliveryAssuranceApplication";
import { createNotificationOutboxDispatchApplication } from "../contexts/notifications/application/notificationOutboxDispatchApplication";
import { createNotificationTargetPlanner } from "../contexts/notifications/public";
import { FirebaseDeliveryAssuranceStore, FirebaseDeliveryMembershipQuery, FirebaseFidDeliveryProvider } from "../adapters/firebase/notifications/firebaseNotificationDeliveryAdapters";
import { FirebaseNotificationMemberCleanupStore } from "../adapters/firebase/notifications/firebaseNotificationMemberCleanupStore";
import { FirebaseLegacyShortcutNotificationGuard, reconcileInterruptedNotificationDeliveries } from "../adapters/firebase/notifications/firebaseNotificationReconciliation";
import { firestoreTtlAfter } from "../adapters/firebase/shared/firestoreTtl";
import { correlationIdFromOpaqueValue, setCurrentInteractiveLatencyOperation, startInteractiveLatencyInvocation } from "../observability/interactiveLatency";
import { HOUSEHOLD_NOTIFICATION_DELIVERY_OPERATION, notificationOutboxConsumerAlreadyTerminal, SHORTCUT_NOTIFICATION_DELIVERY_OPERATION } from "./notificationOutboxLatency";

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}
function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const dispatcher = createNotificationOutboxDispatchApplication({
  delivery: createDeliveryAssuranceApplication(
    createNotificationTargetPlanner(), new FirebaseDeliveryMembershipQuery(db),
    new FirebaseDeliveryAssuranceStore(db), new FirebaseFidDeliveryProvider(messaging),
    { now: () => new Date().toISOString() },
  ),
  memberRemoval: new FirebaseNotificationMemberCleanupStore(db),
  legacyShortcut: new FirebaseLegacyShortcutNotificationGuard(db),
});

export const reconcileNotificationDeliveries = onSchedule({ schedule: "every 5 minutes", region: REGION, timeoutSeconds: 120 }, async () => {
  await reconcileInterruptedNotificationDeliveries(db, new Date().toISOString());
});

export const consumeNotificationOutbox = onDocumentCreated({
  document: "outboxEvents/{eventId}", region: REGION, retry: true, timeoutSeconds: 120,
}, async (event) => {
  const snapshot = event.data;
  if (snapshot === undefined) return;
  const data = record(snapshot.data());
  const eventName = text(data.eventType);
  if (eventName === undefined || !Number.isSafeInteger(data.eventVersion)) throw new Error("OUTBOX_EVENT_TYPE_INVALID");
  const eventType = `${eventName}.v${String(data.eventVersion)}`;
  if (!["HouseholdNotificationRequested.v1", "TransactionRecorded.v1", "CaptureDuplicateObserved.v1", "HouseholdMemberRemoved.v1"].includes(eventType)) return;
  const latest = await snapshot.ref.get();
  if (latest.exists && notificationOutboxConsumerAlreadyTerminal(record(latest.data()))) return;
  const eventId = text(data.eventId) ?? event.params.eventId;
  const latency = startInteractiveLatencyInvocation("consumeNotificationOutbox", {
    correlationId: correlationIdFromOpaqueValue(eventId),
    elapsedBeforeInvocationMs: Math.max(0, Date.now() - snapshot.createTime.toMillis()),
  });
  return latency.run(async () => {
    setCurrentInteractiveLatencyOperation(eventType === "HouseholdNotificationRequested.v1"
      ? HOUSEHOLD_NOTIFICATION_DELIVERY_OPERATION : SHORTCUT_NOTIFICATION_DELIVERY_OPERATION);
    try {
      const householdId = text(data.householdId);
      const occurredAt = text(data.occurredAt);
      if (householdId === undefined || occurredAt === undefined || !Number.isFinite(Date.parse(occurredAt))) throw new Error("OUTBOX_EVENT_ENVELOPE_INVALID");
      const result = await dispatcher.consume({ eventId, eventType, householdId, occurredAt, aggregateId: text(data.aggregateId), payload: record(data.payload) });
      if (result.kind === "Ignored") return;
      const terminalAt = new Date().toISOString();
      await snapshot.ref.set({
        notificationConsumerStatus: result.kind,
        ...("code" in result ? { notificationConsumerCode: result.code } : {}),
        notificationConsumerProcessedAt: terminalAt, terminalAt, expiresAt: firestoreTtlAfter(terminalAt),
      }, { merge: true });
      latency.complete(result.status);
    } catch (error) {
      latency.complete("failed");
      throw error;
    }
  });
});
