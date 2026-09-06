import { createHash } from "node:crypto";
import type * as firestore from "firebase-admin/firestore";
import type { DeliveryReconciliationStore, DeliveryReconciliationTransaction, ReconciliableDeliveryRecord } from "../../../contexts/notifications/application/ports/outbound/deliveryReconciliationPorts";
import { createDeliveryReconciliationApplication } from "../../../contexts/notifications/application/deliveryReconciliationApplication";
import { FirebaseDeliveryAssuranceStore } from "./firebaseNotificationDeliveryAdapters";
import { firestoreInstantAsIso, firestoreTtlAfter, firestoreTtlTimestamp } from "../shared/firestoreTtl";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const STUCK_AFTER_MS = 3 * 60_000;

export class FirebaseDeliveryReconciliationStore implements DeliveryReconciliationStore {
  constructor(private readonly database: firestore.Firestore) {}
  runForDelivery<T>(deliveryId: string, operation: (transaction: DeliveryReconciliationTransaction) => Promise<T>): Promise<T> {
    const reference = this.database.collection("notificationDeliveries").doc(hash(deliveryId));
    const outbox = this.database.collection("outboxEvents").doc(hash(`notification-delivery-terminal:${deliveryId}`));
    return this.database.runTransaction(async (transaction) => {
      const [current, priorEvent] = await Promise.all([transaction.get(reference), transaction.get(outbox)]);
      return operation({
        readDelivery: async () => current.exists ? current.data() as ReconciliableDeliveryRecord : null,
        saveDelivery: async (record) => {
          transaction.set(reference, { ...record, expiresAt: firestoreTtlTimestamp(record.expiresAt!) }, { merge: true });
        },
        appendTerminalEventOnce: async (event) => {
          if (!priorEvent.exists) transaction.create(outbox, {
            eventId: event.eventId, eventType: "NotificationDeliveryTerminated", eventVersion: 1,
            householdId: event.householdId, aggregateId: event.deliveryId, occurredAt: event.occurredAt,
            payload: { deliveryId: event.deliveryId, status: event.status }, status: "completed", terminalAt: event.occurredAt,
            expiresAt: firestoreTtlAfter(event.occurredAt), schemaVersion: 1,
          });
        },
      });
    });
  }
}

/** 이전 Shortcut Inbox를 공통 delivery로 옮길 때 이미 시작한 provider 시도를 재전송하지 않습니다. */
export class FirebaseLegacyShortcutNotificationGuard {
  constructor(private readonly database: firestore.Firestore) {}
  async completion(eventId: string, householdId: string, now: string): Promise<"delivered" | "failed" | undefined> {
    const reference = this.database.collection("shortcutNotificationInboxes").doc(hash(eventId));
    return this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) return undefined;
      const data = snapshot.data()!;
      if (data.status === "completed") {
        if (data.householdId === undefined) transaction.set(reference, { householdId }, { merge: true });
        return data.outcome === "delivered" ? "delivered" : "failed";
      }
      const started = firestoreInstantAsIso(data.createdAt);
      if (started !== undefined && Date.parse(now) - Date.parse(started) < STUCK_AFTER_MS) throw new Error("SHORTCUT_NOTIFICATION_IN_PROGRESS");
      transaction.set(reference, {
        householdId, status: "completed", outcome: "unknown-provider-outcome", terminalAt: now, expiresAt: firestoreTtlAfter(now),
        deliveries: Array.isArray(data.deliveries) ? data.deliveries.map((delivery: Record<string, unknown>) => ({ ...delivery, status: "unknown-provider-outcome" })) : [],
      }, { merge: true });
      return "failed";
    });
  }
}

export async function reconcileInterruptedNotificationDeliveries(database: firestore.Firestore, now: string, limit = 100): Promise<number> {
  const cutoff = new Date(Date.parse(now) - STUCK_AFTER_MS);
  const deliveries = await database.collection("notificationDeliveries").where("status", "==", "sending")
    .where("createdAt", "<=", cutoff).limit(limit).get();
  const application = createDeliveryReconciliationApplication(new FirebaseDeliveryReconciliationStore(database));
  const store = new FirebaseDeliveryAssuranceStore(database);
  let completed = 0;
  for (const document of deliveries.docs) {
    const data = document.data();
    if (typeof data.deliveryId !== "string") continue;
    const started = firestoreInstantAsIso(data.providerAttemptStartedAt ?? data.createdAt);
    if (started !== undefined && Date.parse(started) > cutoff.getTime()) continue;
    await application.reconcileStuckDelivery(data.deliveryId, now);
    if (typeof data.intentId === "string" && typeof data.eventId === "string") {
      const siblings = await store.listIntentDeliveries(data.intentId);
      if (siblings.every((delivery) => delivery.status !== "queued" && delivery.status !== "sending")) {
        await store.completeIntent({ intentId: data.intentId, eventId: data.eventId, terminalAt: now, expiresAt: new Date(Date.parse(now) + 30 * 86400000).toISOString() });
      }
    }
    completed += 1;
  }
  const legacy = await database.collection("shortcutNotificationInboxes").where("status", "==", "in-progress").where("createdAt", "<=", cutoff).limit(limit).get();
  const guard = new FirebaseLegacyShortcutNotificationGuard(database);
  for (const document of legacy.docs) {
    const data = document.data();
    if (typeof data.eventId !== "string") continue;
    const event = await database.collection("outboxEvents").doc(data.eventId).get();
    const householdId = data.householdId ?? event.data()?.householdId;
    if (typeof householdId === "string") { await guard.completion(data.eventId, householdId, now); completed += 1; }
  }
  return completed;
}
