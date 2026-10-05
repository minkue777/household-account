import { FieldValue, type Firestore } from "firebase-admin/firestore";

import type {
  DiagnosticNotification,
} from "../../../contexts/payment-capture/android-payment-ingestion/application/ports/in/diagnosticRetentionInputPort";
import type { DiagnosticDocumentStore } from "../../../contexts/payment-capture/android-payment-ingestion/application/ports/out/diagnosticDocumentStore";

const COLLECTION = "notification_debug_logs";

export class FirebaseDiagnosticDocumentStore implements DiagnosticDocumentStore {
  constructor(private readonly database: Firestore) {}

  async write(input: {
    readonly actor: { readonly householdId: string; readonly memberId: string };
    readonly notification: DiagnosticNotification;
  }): Promise<
    | { readonly kind: "Written"; readonly diagnosticId: string }
    | { readonly kind: "Failed" }
  > {
    const reference = this.database.collection(COLLECTION).doc();
    try {
      await reference.set({
        householdId: input.actor.householdId,
        memberId: input.actor.memberId,
        packageName: input.notification.packageName,
        source: input.notification.sourceType,
        sourceType: input.notification.sourceType,
        title: input.notification.title,
        text: input.notification.text,
        bigText: input.notification.bigText,
        textLines: [...input.notification.textLines],
        fullText: input.notification.fullText,
        postedAtMillis: input.notification.postedAtMillis,
        observedAt: new Date(input.notification.postedAtMillis),
        collectedAt: input.notification.collectedAt,
        createdAt: FieldValue.serverTimestamp(),
      });
      return { kind: "Written", diagnosticId: reference.id };
    } catch {
      return { kind: "Failed" };
    }
  }

}
