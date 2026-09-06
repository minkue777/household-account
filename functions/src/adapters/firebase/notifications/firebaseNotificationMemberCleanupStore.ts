import { createHash } from "node:crypto";
import type * as firestore from "firebase-admin/firestore";
import { firestoreTtlAfter } from "../shared/firestoreTtl";

export class FirebaseNotificationMemberCleanupStore {
  constructor(private readonly database: firestore.Firestore) {}

  async cleanupMemberEndpoints(eventId: string, householdId: string, memberId: string, occurredAt: string) {
    const receipt = this.database.collection("notificationMemberCleanupReceipts")
      .doc(createHash("sha256").update(eventId).digest("hex"));
    return this.database.runTransaction(async (transaction) => {
      const previous = await transaction.get(receipt);
      if (previous.exists) return { replayed: true, removedEndpointCount: previous.data()?.removedEndpointCount ?? 0 };
      const endpoints = await transaction.get(this.database.collection("notificationEndpoints")
        .where("householdId", "==", householdId).where("memberId", "==", memberId));
      const removed = endpoints.docs.filter((endpoint) => {
        const confirmedAt = endpoint.data().lastConfirmedAt;
        return typeof confirmedAt !== "string" || Date.parse(confirmedAt) <= Date.parse(occurredAt);
      });
      for (const endpoint of removed) transaction.delete(endpoint.ref);
      const terminalAt = new Date().toISOString();
      transaction.create(receipt, { eventId, householdId, memberId, removedEndpointCount: removed.length, terminalAt, expiresAt: firestoreTtlAfter(terminalAt) });
      return { replayed: false, removedEndpointCount: removed.length };
    });
  }
}
