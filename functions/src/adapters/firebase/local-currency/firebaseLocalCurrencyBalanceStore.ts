import { createHash } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

import type {
  BalanceObservationReceipt,
  LocalCurrencyBalanceChangedEvent,
  LocalCurrencyBalanceStore,
  LocalCurrencyBalanceTransaction,
} from "../../../contexts/household-finance/local-currency/application/ports/outbound/localCurrencyBalanceStore";
import type {
  LegacyLocalCurrencyBalanceState,
  LocalCurrencyBalanceState,
  SupportedLocalCurrencyType,
} from "../../../contexts/household-finance/local-currency/domain/model/localCurrencyBalance";

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function instant(value: unknown): string | undefined {
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof value.toDate === "function"
  ) {
    return (value.toDate() as Date).toISOString();
  }
  return undefined;
}

function balanceState(
  snapshot: firestore.DocumentSnapshot,
): LocalCurrencyBalanceState | null {
  if (!snapshot.exists) return null;
  const data = snapshot.data();
  if (
    data === undefined ||
    typeof data.householdId !== "string" ||
    typeof data.localCurrencyType !== "string" ||
    typeof data.balanceInWon !== "number" ||
    typeof data.observedAt !== "string"
  ) {
    return null;
  }
  const updatedAt = instant(data.updatedAt) ?? data.observedAt;
  return {
    balanceId:
      typeof data.balanceId === "string" ? data.balanceId : snapshot.id,
    householdId: data.householdId,
    localCurrencyType: data.localCurrencyType as SupportedLocalCurrencyType,
    ...(typeof data.displayName === "string"
      ? { displayName: data.displayName }
      : {}),
    balanceInWon: data.balanceInWon,
    observedAt: data.observedAt,
    updatedAt,
    balanceVersion:
      typeof data.balanceVersion === "number" ? data.balanceVersion : 1,
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 2,
    lastObservationId:
      typeof data.lastObservationId === "string" ? data.lastObservationId : "legacy",
  };
}

function legacyState(
  snapshot: firestore.DocumentSnapshot,
): LegacyLocalCurrencyBalanceState | null {
  if (!snapshot.exists) return null;
  const data = snapshot.data();
  if (
    data === undefined ||
    typeof data.householdId !== "string" ||
    (typeof data.balanceInWon !== "number" && typeof data.balance !== "number")
  ) {
    return null;
  }
  const observedAt =
    instant(data.observedAt) ?? instant(data.updatedAt) ?? new Date(0).toISOString();
  return {
    balanceId:
      typeof data.balanceId === "string" ? data.balanceId : snapshot.id,
    householdId: data.householdId,
    ...(typeof data.displayName === "string"
      ? { displayName: data.displayName }
      : typeof data.currencyType === "string"
        ? { displayName: data.currencyType }
        : {}),
    balanceInWon: Number(data.balanceInWon ?? data.balance),
    observedAt,
    updatedAt: instant(data.updatedAt) ?? observedAt,
    balanceVersion:
      typeof data.balanceVersion === "number" ? data.balanceVersion : 1,
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 1,
  };
}

export class FirebaseLocalCurrencyBalanceStore
  implements LocalCurrencyBalanceStore
{
  constructor(private readonly database: firestore.Firestore) {}

  async runInHouseholdTransaction<T>(
    householdId: string,
    operation: (transaction: LocalCurrencyBalanceTransaction) => Promise<T>,
  ): Promise<T> {
    const household = this.database.collection("households").doc(householdId);
    return this.database.runTransaction(async (unitOfWork) => {
      const adapter: LocalCurrencyBalanceTransaction = {
        readBalance: async (scope, localCurrencyType) => {
          if (scope !== householdId) return null;
          return balanceState(
            await unitOfWork.get(
              household.collection("localCurrencyBalances").doc(localCurrencyType),
            ),
          );
        },
        readReceipt: async (scope, observationId) => {
          if (scope !== householdId) return null;
          const snapshot = await unitOfWork.get(
            household
              .collection("balanceObservationReceipts")
              .doc(hash(`${householdId}\u0000${observationId}`)),
          );
          return snapshot.exists
            ? (snapshot.data() as BalanceObservationReceipt)
            : null;
        },
        saveBalance: async (balance) => {
          const canonical = household
            .collection("localCurrencyBalances")
            .doc(balance.localCurrencyType);
          const legacy = this.database
            .collection("balances")
            .doc(hash(`${householdId}\u0000${balance.localCurrencyType}`));
          unitOfWork.set(
            canonical,
            {
              ...balance,
              updatedAtIso: balance.updatedAt,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
          unitOfWork.set(
            legacy,
            {
              householdId,
              type: "localCurrency",
              currencyType: balance.localCurrencyType,
              localCurrencyType: balance.localCurrencyType,
              balance: balance.balanceInWon,
              balanceInWon: balance.balanceInWon,
              observedAt: balance.observedAt,
              balanceVersion: balance.balanceVersion,
              schemaVersion: 1,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        },
        saveReceipt: async (receipt) => {
          unitOfWork.set(
            household
              .collection("balanceObservationReceipts")
              .doc(hash(`${householdId}\u0000${receipt.observationId}`)),
            {
              ...receipt,
              schemaVersion: 1,
              createdAt: FieldValue.serverTimestamp(),
            },
          );
        },
        appendChangedEvent: async (event: LocalCurrencyBalanceChangedEvent) => {
          const eventId = hash(
            `${event.householdId}\u0000${event.balanceId}\u0000${event.balanceVersion}`,
          );
          unitOfWork.create(this.database.collection("outboxEvents").doc(eventId), {
            eventId,
            eventType: "LocalCurrencyBalanceChanged",
            eventVersion: 1,
            producerContext: "household-finance.local-currency",
            householdId: event.householdId,
            aggregateId: event.balanceId,
            aggregateVersion: event.balanceVersion,
            occurredAt: event.occurredAt,
            correlationId: event.balanceId,
            causationId: event.balanceId,
            payload: {
              balanceId: event.balanceId,
              localCurrencyType: event.localCurrencyType,
              balanceVersion: event.balanceVersion,
            },
            status: "pending",
            schemaVersion: 1,
            createdAt: FieldValue.serverTimestamp(),
          });
        },
      };
      return operation(adapter);
    });
  }

  async readBalance(
    householdId: string,
    localCurrencyType: SupportedLocalCurrencyType,
  ): Promise<LocalCurrencyBalanceState | null> {
    return balanceState(
      await this.database
        .collection("households")
        .doc(householdId)
        .collection("localCurrencyBalances")
        .doc(localCurrencyType)
        .get(),
    );
  }

  async readLegacyBalance(
    householdId: string,
  ): Promise<LegacyLocalCurrencyBalanceState | null> {
    const snapshot = await this.database
      .collection("balances")
      .where("householdId", "==", householdId)
      .where("type", "==", "localCurrency")
      .limit(1)
      .get();
    return snapshot.empty ? null : legacyState(snapshot.docs[0]);
  }
}
