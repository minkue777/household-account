import { createHash } from "node:crypto";
import type * as firestore from "firebase-admin/firestore";
import type { NotificationHouseholdPurgeStore, NotificationOwnedRecord, NotificationPurgePageReceipt, NotificationPurgePageTransaction } from "../../../contexts/notifications/application/ports/outbound/notificationHouseholdPurgeStore";
import { notificationPurgeCheckpointKey, notificationPurgeRecordKey } from "../../../contexts/notifications/domain/policies/notificationPurgePolicy";
import { createNotificationHouseholdPurgeApplication } from "../../../contexts/notifications/public";
import type { NotificationHouseholdPurgeInputPort, NotificationPurgePageResult } from "../../../contexts/notifications/application/ports/in/notificationHouseholdPurgePort";

export class FirebaseNotificationHouseholdPurgeStore implements NotificationHouseholdPurgeStore {
  constructor(private readonly database: firestore.Firestore, private readonly limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("INVALID_NOTIFICATION_PURGE_PAGE_SIZE");
  }
  pageSize() { return this.limit; }
  runPage<T>(input: { householdId: string; processId: string; checkpoint: string }, operation: (transaction: NotificationPurgePageTransaction) => Promise<T>): Promise<T> {
    const receipt = this.database.collection("households").doc(input.householdId).collection("notificationPurgeReceipts")
      .doc(createHash("sha256").update(JSON.stringify([input.processId, input.checkpoint])).digest("hex"));
    const stores: readonly { kind: NotificationOwnedRecord["kind"]; path: string; scoped?: boolean }[] = [
      { kind: "delivery", path: "notificationDeliveries" },
      { kind: "endpoint", path: "notificationEndpoints" },
      { kind: "endpoint", path: `households/${input.householdId}/notificationRecipientPreferences`, scoped: true },
      { kind: "inbox", path: "notificationInboxes" },
      { kind: "inbox", path: "notificationMemberCleanupReceipts" },
      { kind: "inbox", path: "shortcutNotificationInboxes" },
      { kind: "intent", path: "notificationIntents" },
    ];
    return this.database.runTransaction(async (transaction) => {
      const previous = await transaction.get(receipt);
      return operation({
        readReceipt: async () => previous.exists ? previous.data() as NotificationPurgePageReceipt : null,
        listRecordsAfter: async (page) => {
          const cursor = notificationPurgeCheckpointKey(page.checkpoint);
          const records: NotificationOwnedRecord[] = [];
          for (const store of stores) {
            const prefix = `${store.kind}\u0000${store.path}/`;
            if (cursor !== null && !cursor.startsWith(prefix) && prefix < cursor) continue;
            let query: firestore.Query = this.database.collection(store.path);
            if (!store.scoped) query = query.where("householdId", "==", input.householdId);
            query = query.orderBy("__name__");
            if (cursor?.startsWith(prefix)) query = query.startAfter(cursor.slice(prefix.length));
            const snapshot = await transaction.get(query.limit(page.limit));
            records.push(...snapshot.docs.map((document) => ({ kind: store.kind, householdId: input.householdId, recordId: `${store.path}/${document.id}` })));
          }
          return records.sort((left, right) => notificationPurgeRecordKey(left) < notificationPurgeRecordKey(right) ? -1 : notificationPurgeRecordKey(left) > notificationPurgeRecordKey(right) ? 1 : 0).slice(0, page.limit);
        },
        deleteRecords: async (records) => {
          for (const record of records) {
            const store = stores.find((candidate) => record.kind === candidate.kind && record.recordId.startsWith(`${candidate.path}/`));
            if (record.householdId !== input.householdId || store === undefined || record.recordId.slice(store.path.length + 1).includes("/")) throw new Error("NOTIFICATION_PURGE_SCOPE_MISMATCH");
            transaction.delete(this.database.collection(store.path).doc(record.recordId.slice(store.path.length + 1)));
          }
        },
        saveReceipt: async (value) => { transaction.create(receipt, { ...value, schemaVersion: 1 }); },
      });
    });
  }
}

export function createFirebaseNotificationHouseholdPurgeApplication(database: firestore.Firestore, pageSize = 100): NotificationHouseholdPurgeInputPort {
  const application = createNotificationHouseholdPurgeApplication(new FirebaseNotificationHouseholdPurgeStore(database, pageSize));
  const sources = ["notificationInboxes", "shortcutNotificationInboxes"];
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  return {
    handleHouseholdLifecycleSignal: (input) => application.handleHouseholdLifecycleSignal(input),
    async purgeHouseholdData(actor, input) {
      if (!actor.capabilities.includes("householdLifecycle:purge")) return { kind: "Forbidden", code: "PURGE_SYSTEM_CAPABILITY_REQUIRED" };
      if (input.checkpoint.startsWith("DATA:")) {
        const result = await application.purgeHouseholdData(actor, { ...input, checkpoint: input.checkpoint.slice(5) });
        return result.kind === "PageProcessed" ? { ...result, checkpoint: input.checkpoint, nextCheckpoint: `DATA:${result.nextCheckpoint}` }
          : result.kind === "PurgeCompleted" ? { ...result, checkpoint: input.checkpoint } : result;
      }
      const cursor = input.checkpoint === "START" ? [0, ""] : JSON.parse(decodeURIComponent(input.checkpoint.replace(/^OWNERSHIP:/, "")));
      const [sourceIndex, afterId] = cursor as [number, string];
      if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= sources.length || typeof afterId !== "string") throw new Error("INVALID_NOTIFICATION_OWNERSHIP_CHECKPOINT");
      const receipt = database.collection("households").doc(input.householdId).collection("notificationPurgeOwnershipReceipts").doc(hash(JSON.stringify([input.processId, input.checkpoint])));
      return database.runTransaction(async (transaction) => {
        const prior = await transaction.get(receipt);
        if (prior.exists) return prior.data()!.result as NotificationPurgePageResult;
        let query: firestore.Query = database.collection(sources[sourceIndex]).orderBy("__name__");
        if (afterId !== "") query = query.startAfter(afterId);
        const page = await transaction.get(query.limit(pageSize));
        const updates: firestore.DocumentReference[] = [];
        for (const row of page.docs) {
          const data = row.data();
          if (typeof data.householdId === "string") continue;
          const event = typeof data.eventId === "string" ? await transaction.get(database.collection("outboxEvents").doc(data.eventId)) : undefined;
          const intent = typeof data.intentId === "string" ? await transaction.get(database.collection("notificationIntents").doc(hash(data.intentId))) : undefined;
          const owner = event?.data()?.householdId ?? intent?.data()?.householdId;
          if (typeof owner !== "string") throw new Error(`NOTIFICATION_LEGACY_OWNERSHIP_UNRESOLVED:${row.ref.path}`);
          if (owner === input.householdId) updates.push(row.ref);
        }
        const nextCheckpoint = page.size === pageSize
          ? `OWNERSHIP:${encodeURIComponent(JSON.stringify([sourceIndex, page.docs.at(-1)!.id]))}`
          : sourceIndex + 1 < sources.length ? `OWNERSHIP:${encodeURIComponent(JSON.stringify([sourceIndex + 1, ""]))}` : "DATA:START";
        const result: NotificationPurgePageResult = { kind: "PageProcessed", processId: input.processId, checkpoint: input.checkpoint, nextCheckpoint, deletedCount: 0 };
        for (const reference of updates) transaction.set(reference, { householdId: input.householdId }, { merge: true });
        transaction.create(receipt, { householdId: input.householdId, result, schemaVersion: 1 });
        return result;
      });
    },
  };
}
