import { createHash } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import type { Messaging } from "firebase-admin/messaging";

import type { MobileNotificationEndpoint } from "../../../contexts/notifications/domain/model/mobileNotificationEndpoint";
import type { NotificationProviderOutcome } from "../../../contexts/notifications/domain/model/deliveryAssurance";
import type {
  AssuredDeliveryTransaction,
  DeliveryAcceptanceTransaction,
  DeliveryAssuranceProviderPort,
  DeliveryAssuranceStore,
  DeliveryMembershipQueryPort,
  StoredAssuredDelivery,
  StoredDeliveryAssuranceInbox,
  StoredDeliveryAssuranceIntent,
} from "../../../contexts/notifications/application/ports/outbound/deliveryAssurancePorts";
import type {
  ShortcutDeliveryRecord,
  ShortcutNotificationFacts,
  ShortcutNotificationFactsQuery,
  ShortcutProviderOutcome,
  ShortcutTransactionNotificationProvider,
  ShortcutTransactionNotificationStore,
} from "../../../contexts/notifications/application/ports/outbound/shortcutTransactionNotificationPorts";
import type { NotificationTarget } from "../../../contexts/notifications/domain/model/notificationTarget";
import { mapFirebaseMobileEndpoint } from "./firebaseMobileEndpointRegistrationStore";
import { decideEndpointInactivation } from "../../../contexts/notifications/domain/policies/endpointInactivationPolicy";
import {
  firestoreInstantAsIso,
  firestoreTtlAfter,
  firestoreTtlMergeField,
} from "../shared/firestoreTtl";

const INBOXES = "notificationInboxes";
const INTENTS = "notificationIntents";
const DELIVERIES = "notificationDeliveries";
const ENDPOINTS = "notificationEndpoints";
const SHORTCUT_INBOXES = "shortcutNotificationInboxes";

function documentId(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function withoutUndefined<T extends Readonly<Record<string, unknown>>>(
  value: T,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, candidate]) => candidate !== undefined),
  );
}

function mapTtlDocument<T>(data: firestore.DocumentData): T {
  const expiresAt = firestoreInstantAsIso(data.expiresAt);
  const { expiresAt: _storedExpiresAt, ...fields } = data;
  return {
    ...fields,
    ...(expiresAt === undefined ? {} : { expiresAt }),
  } as T;
}

function ttlDocument(value: Readonly<Record<string, unknown>>) {
  const { expiresAt, ...fields } = value;
  if (expiresAt !== undefined && typeof expiresAt !== "string") {
    throw new Error("NOTIFICATION_TTL_INVALID");
  }
  return {
    ...withoutUndefined(fields),
    ...firestoreTtlMergeField(expiresAt),
  };
}

function mapInbox(
  snapshot: firestore.DocumentSnapshot,
): StoredDeliveryAssuranceInbox | null {
  if (!snapshot.exists) return null;
  return mapTtlDocument<StoredDeliveryAssuranceInbox>(snapshot.data() ?? {});
}

function mapIntent(
  snapshot: firestore.DocumentSnapshot,
): StoredDeliveryAssuranceIntent | null {
  if (!snapshot.exists) return null;
  return mapTtlDocument<StoredDeliveryAssuranceIntent>(snapshot.data() ?? {});
}

function mapDelivery(
  snapshot: firestore.DocumentSnapshot,
): StoredAssuredDelivery | null {
  if (!snapshot.exists) return null;
  return mapTtlDocument<StoredAssuredDelivery>(snapshot.data() ?? {});
}

function endpointDocument(endpoint: MobileNotificationEndpoint) {
  const { expiresAt, ...fields } = endpoint;
  return {
    ...withoutUndefined(fields as unknown as Readonly<Record<string, unknown>>),
    ...firestoreTtlMergeField(expiresAt),
    schemaVersion: 1,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

export class FirebaseDeliveryMembershipQuery
  implements DeliveryMembershipQueryPort
{
  constructor(private readonly database: firestore.Firestore) {}

  async status(householdId: string, memberId: string) {
    try {
      const member = await this.database
        .collection("households")
        .doc(householdId)
        .collection("members")
        .doc(memberId)
        .get();
      if (!member.exists) return "removed" as const;
      const data = member.data();
      return data?.lifecycleState === "removed" || data?.status === "removed"
        ? ("removed" as const)
        : ("active" as const);
    } catch (_error) {
      return "unavailable" as const;
    }
  }
}

export class FirebaseDeliveryAssuranceStore implements DeliveryAssuranceStore {
  constructor(private readonly database: firestore.Firestore) {}

  async readInbox(eventId: string): Promise<StoredDeliveryAssuranceInbox | null> {
    return mapInbox(
      await this.database.collection(INBOXES).doc(documentId(eventId)).get(),
    );
  }

  runAcceptance<T>(
    eventId: string,
    operation: (transaction: DeliveryAcceptanceTransaction) => Promise<T>,
  ): Promise<T> {
    const inboxReference = this.database
      .collection(INBOXES)
      .doc(documentId(eventId));
    return this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(inboxReference);
      let nextInbox: StoredDeliveryAssuranceInbox | undefined;
      let nextIntent: StoredDeliveryAssuranceIntent | undefined;
      let nextDeliveries: readonly StoredAssuredDelivery[] = [];
      const result = await operation({
        readInbox: async () => mapInbox(snapshot),
        saveInbox: async (record) => {
          nextInbox = record;
        },
        saveIntent: async (record) => {
          nextIntent = record;
        },
        saveDeliveries: async (records) => {
          nextDeliveries = records;
        },
      });
      if (nextIntent !== undefined) {
        transaction.set(
          this.database.collection(INTENTS).doc(documentId(nextIntent.intentId)),
          {
            ...ttlDocument(
              nextIntent as unknown as Readonly<Record<string, unknown>>,
            ),
            schemaVersion: 1,
            createdAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
      for (const delivery of nextDeliveries) {
        transaction.set(
          this.database
            .collection(DELIVERIES)
            .doc(documentId(delivery.deliveryId)),
          {
            ...ttlDocument(
              delivery as unknown as Readonly<Record<string, unknown>>,
            ),
            schemaVersion: 1,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
      if (nextInbox !== undefined) {
        transaction.set(
          inboxReference,
          {
            ...ttlDocument(
              nextInbox as unknown as Readonly<Record<string, unknown>>,
            ),
            schemaVersion: 1,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
      return result;
    });
  }

  async listEndpoints(
    householdId: string,
  ): Promise<readonly MobileNotificationEndpoint[]> {
    const snapshot = await this.database
      .collection(ENDPOINTS)
      .where("householdId", "==", householdId)
      .get();
    return snapshot.docs
      .map(mapFirebaseMobileEndpoint)
      .filter(
        (endpoint): endpoint is MobileNotificationEndpoint => endpoint !== null,
      );
  }

  runForDelivery<T>(
    deliveryId: string,
    operation: (transaction: AssuredDeliveryTransaction) => Promise<T>,
  ): Promise<T> {
    const deliveryReference = this.database
      .collection(DELIVERIES)
      .doc(documentId(deliveryId));
    return this.database.runTransaction(async (transaction) => {
      const deliverySnapshot = await transaction.get(deliveryReference);
      const initialDelivery = mapDelivery(deliverySnapshot);
      const endpointReference =
        initialDelivery === null
          ? undefined
          : this.database.collection(ENDPOINTS).doc(initialDelivery.endpointId);
      const endpointSnapshot =
        endpointReference === undefined
          ? undefined
          : await transaction.get(endpointReference);
      let nextDelivery: StoredAssuredDelivery | undefined;
      let nextEndpoint: MobileNotificationEndpoint | undefined;
      const result = await operation({
        readDelivery: async () => initialDelivery,
        saveDelivery: async (record) => {
          nextDelivery = record;
        },
        readEndpoint: async (endpointId) => {
          if (
            endpointReference === undefined ||
            endpointReference.id !== endpointId ||
            endpointSnapshot === undefined
          ) {
            return null;
          }
          return mapFirebaseMobileEndpoint(endpointSnapshot);
        },
        saveEndpoint: async (endpoint) => {
          nextEndpoint = endpoint;
        },
      });
      if (nextDelivery !== undefined) {
        transaction.set(
          deliveryReference,
          {
            ...ttlDocument(
              nextDelivery as unknown as Readonly<Record<string, unknown>>,
            ),
            schemaVersion: 1,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
      if (nextEndpoint !== undefined) {
        transaction.set(
          this.database.collection(ENDPOINTS).doc(nextEndpoint.endpointId),
          endpointDocument(nextEndpoint),
          { merge: true },
        );
      }
      return result;
    });
  }

  async waitForTerminalDelivery(
    deliveryId: string,
  ): Promise<StoredAssuredDelivery> {
    const current = await this.readDelivery(deliveryId);
    if (
      current === null ||
      current.status === "queued" ||
      current.status === "sending"
    ) {
      throw new Error("NOTIFICATION_DELIVERY_IN_PROGRESS");
    }
    return current;
  }

  async readDelivery(deliveryId: string): Promise<StoredAssuredDelivery | null> {
    return mapDelivery(
      await this.database
        .collection(DELIVERIES)
        .doc(documentId(deliveryId))
        .get(),
    );
  }

  async readIntent(intentId: string): Promise<StoredDeliveryAssuranceIntent | null> {
    return mapIntent(
      await this.database.collection(INTENTS).doc(documentId(intentId)).get(),
    );
  }

  async listIntentDeliveries(
    intentId: string,
  ): Promise<readonly StoredAssuredDelivery[]> {
    const snapshot = await this.database
      .collection(DELIVERIES)
      .where("intentId", "==", intentId)
      .get();
    return snapshot.docs
      .map(mapDelivery)
      .filter((value): value is StoredAssuredDelivery => value !== null);
  }

  async listIntents(
    householdId: string,
  ): Promise<readonly StoredDeliveryAssuranceIntent[]> {
    const snapshot = await this.database
      .collection(INTENTS)
      .where("householdId", "==", householdId)
      .get();
    return snapshot.docs
      .map(mapIntent)
      .filter((value): value is StoredDeliveryAssuranceIntent => value !== null);
  }

  async completeIntent(input: {
    intentId: string;
    eventId: string;
    terminalAt: string;
    expiresAt: string;
  }): Promise<void> {
    const intentReference = this.database
      .collection(INTENTS)
      .doc(documentId(input.intentId));
    const inboxReference = this.database
      .collection(INBOXES)
      .doc(documentId(input.eventId));
    await this.database.runTransaction(async (transaction) => {
      const [intent, inbox] = await Promise.all([
        transaction.get(intentReference),
        transaction.get(inboxReference),
      ]);
      if (!intent.exists || intent.data()?.eventId !== input.eventId) {
        throw new Error("NOTIFICATION_INTENT_NOT_FOUND");
      }
      if (!inbox.exists || inbox.data()?.intentId !== input.intentId) {
        throw new Error("NOTIFICATION_INBOX_NOT_FOUND");
      }
      const terminal = {
        status: "terminal",
        terminalAt: input.terminalAt,
        ...firestoreTtlMergeField(input.expiresAt),
        updatedAt: FieldValue.serverTimestamp(),
      };
      transaction.set(intentReference, terminal, { merge: true });
      transaction.set(inboxReference, terminal, { merge: true });
    });
  }
}

function providerError(error: unknown): NotificationProviderOutcome {
  const record =
    typeof error === "object" && error !== null
      ? (error as Record<string, unknown>)
      : {};
  const code = String(record.code ?? "").toUpperCase();
  const message = String(record.message ?? "").toUpperCase();
  if (code.includes("UNREGISTERED") || code.includes("NOT-REGISTERED") || message.includes("UNREGISTERED")) {
    return { kind: "http-error", httpStatus: 404, code: "UNREGISTERED" };
  }
  if (code.includes("QUOTA") || code.includes("RATE-EXCEEDED")) {
    return { kind: "quota" };
  }
  if (code.includes("CREDENTIAL") || code.includes("AUTHENTICATION")) {
    return { kind: "credential-error" };
  }
  if (code.includes("TIMEOUT") || message.includes("TIMEOUT")) {
    return { kind: "timeout" };
  }
  return { kind: "network-error" };
}

export class FirebaseFidDeliveryProvider
  implements DeliveryAssuranceProviderPort
{
  constructor(private readonly messaging: Messaging) {}

  async sendOne(input: {
    deliveryId: string;
    endpointId: string;
    fid: string;
    payload: NotificationTarget["payload"];
  }) {
    try {
      const notificationData = {
        payloadVersion: input.payload.payloadVersion,
        type: input.payload.type,
        clickTarget: input.payload.clickTarget,
        expenseId: input.payload.expenseId,
        deliveryId: input.deliveryId,
        endpointId: input.endpointId,
      };
      await this.messaging.send({
        fid: input.fid,
        notification: {
          title: "가계부 알림",
          body: "새 지출 내역을 확인해 주세요.",
        },
        data: notificationData,
        webpush: {
          notification: {
            icon: "/icons/icon-192x192.png",
            badge: "/icons/icon-72x72.png",
            data: notificationData,
          },
          fcmOptions: {
            link: `/?edit=${encodeURIComponent(input.payload.expenseId)}`,
          },
        },
      });
      return { kind: "success" } as const;
    } catch (error) {
      return providerError(error);
    }
  }
}

export class FirebaseShortcutNotificationFactsQuery
  implements ShortcutNotificationFactsQuery
{
  constructor(private readonly database: firestore.Firestore) {}

  async load(householdId: string): Promise<ShortcutNotificationFacts> {
    const [members, endpoints] = await Promise.all([
      this.database
        .collection("households")
        .doc(householdId)
        .collection("members")
        .get(),
      this.database
        .collection(ENDPOINTS)
        .where("householdId", "==", householdId)
        .get(),
    ]);
    return {
      members: members.docs.map((document) => ({
        householdId,
        memberId: document.id,
        status:
          document.data().lifecycleState === "removed" ||
          document.data().status === "removed"
            ? ("removed" as const)
            : ("active" as const),
      })),
      endpoints: endpoints.docs
        .map(mapFirebaseMobileEndpoint)
        .filter(
          (endpoint): endpoint is MobileNotificationEndpoint => endpoint !== null,
        ),
    };
  }
}

interface ShortcutInboxDocument {
  readonly eventId: string;
  readonly transactionId: string;
  readonly status: "in-progress" | "completed";
  readonly outcome?: ShortcutProviderOutcome;
  readonly deliveries: readonly ShortcutDeliveryRecord[];
}

export class FirebaseShortcutTransactionNotificationStore
  implements ShortcutTransactionNotificationStore
{
  constructor(private readonly database: firestore.Firestore) {}

  async claimEvent(input: {
    eventId: string;
    transactionId: string;
    deliveries: readonly ShortcutDeliveryRecord[];
  }) {
    const reference = this.database
      .collection(SHORTCUT_INBOXES)
      .doc(documentId(input.eventId));
    return this.database.runTransaction(async (transaction) => {
      const current = await transaction.get(reference);
      if (current.exists) {
        const data = current.data() as ShortcutInboxDocument;
        return data.status === "completed" && data.outcome !== undefined
          ? ({ kind: "completed", outcome: data.outcome } as const)
          : ({ kind: "in-progress" } as const);
      }
      transaction.create(reference, {
        eventId: input.eventId,
        transactionId: input.transactionId,
        status: "in-progress",
        deliveries: input.deliveries,
        schemaVersion: 1,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { kind: "claimed", deliveries: input.deliveries } as const;
    });
  }

  async completeEvent(input: {
    eventId: string;
    outcome: ShortcutProviderOutcome;
    deliveries: readonly ShortcutDeliveryRecord[];
  }): Promise<void> {
    const inboxReference = this.database
      .collection(SHORTCUT_INBOXES)
      .doc(documentId(input.eventId));
    const permanentlyFailed = input.deliveries.filter(
      ({ status }) => status === "permanent-failure",
    );
    await this.database.runTransaction(async (transaction) => {
      const endpointReferences = permanentlyFailed.map(({ endpointId }) =>
        this.database.collection(ENDPOINTS).doc(endpointId),
      );
      const endpointSnapshots = await Promise.all(
        endpointReferences.map((reference) => transaction.get(reference)),
      );
      const now = new Date().toISOString();
      permanentlyFailed.forEach((delivery, index) => {
        const current = mapFirebaseMobileEndpoint(endpointSnapshots[index]);
        const decision = decideEndpointInactivation({
          current,
          expectedRegistrationVersion: delivery.expectedRegistrationVersion,
          expectedBindingVersion: delivery.expectedBindingVersion,
          now,
          observation: {
            source: "provider",
            httpStatus: 404,
            code: "UNREGISTERED",
          },
        });
        if (decision.kind === "Inactivated") {
          transaction.set(
            endpointReferences[index],
            endpointDocument(decision.endpoint),
            { merge: true },
          );
        }
      });
      transaction.set(
        inboxReference,
        {
          status: "completed",
          outcome: input.outcome,
          deliveries: input.deliveries,
          terminalAt: now,
          expiresAt: firestoreTtlAfter(now),
          completedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });
  }

  async waitForCompletion(eventId: string): Promise<ShortcutProviderOutcome> {
    const snapshot = await this.database
      .collection(SHORTCUT_INBOXES)
      .doc(documentId(eventId))
      .get();
    const data = snapshot.data() as ShortcutInboxDocument | undefined;
    if (data?.status !== "completed" || data.outcome === undefined) {
      throw new Error("SHORTCUT_NOTIFICATION_IN_PROGRESS");
    }
    return data.outcome;
  }
}

export class FirebaseShortcutFidProvider
  implements ShortcutTransactionNotificationProvider
{
  constructor(private readonly messaging: Messaging) {}

  async sendOne(input: {
    eventId: string;
    endpointId: string;
    fid: string;
    payload: NotificationTarget["payload"];
  }) {
    const result = await new FirebaseFidDeliveryProvider(this.messaging).sendOne({
      deliveryId: input.eventId,
      endpointId: input.endpointId,
      fid: input.fid,
      payload: input.payload,
    });
    switch (result.kind) {
      case "success":
        return "delivered" as const;
      case "http-error":
        return result.httpStatus === 404 && result.code === "UNREGISTERED"
          ? ("permanent-failure" as const)
          : result.httpStatus === 404
            ? ("contract-failure" as const)
            : ("failed" as const);
      case "timeout":
        return "unknown-provider-outcome" as const;
      case "quota":
      case "network-error":
        return "failed" as const;
      case "credential-error":
        return "contract-failure" as const;
    }
  }
}

export { providerError as classifyFirebaseMessagingError };
