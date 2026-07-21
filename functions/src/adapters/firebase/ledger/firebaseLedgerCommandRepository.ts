import { createHash } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

import type {
  LedgerCommandRepository,
  LedgerRepositoryReadResult,
} from "../../../contexts/household-finance/ledger/application/ports/basicLedgerRepository";
import type {
  LedgerCommandResult,
  LedgerTransactionView,
} from "../../../contexts/household-finance/ledger/domain/model/ledgerTransaction";
import { mergeCanonicalLedgerTransactions } from "./migrationAwareLedgerUnion";
import { FirebaseTransactionalOutbox } from "../outbox/firebaseTransactionalOutbox";
import { firestoreTtlAfter } from "../shared/firestoreTtl";

const TRANSACTIONS = "expenses";
const RECEIPT_CONTEXT = "household-finance-ledger";

function receiptId(householdId: string, commandId: string): string {
  return createHash("sha256")
    .update(`${householdId}\u0000${commandId}`, "utf8")
    .digest("hex");
}

function terminalExpiry(occurredAt: string) {
  return firestoreTtlAfter(occurredAt);
}

function text(data: FirebaseFirestore.DocumentData, ...fields: string[]): string {
  for (const field of fields) {
    const value = data[field];
    if (typeof value === "string") return value;
  }
  return "";
}

function numberValue(
  data: FirebaseFirestore.DocumentData,
  fallback: number,
  ...fields: string[]
): number {
  for (const field of fields) {
    const value = data[field];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return fallback;
}

function mapTransaction(
  snapshot: firestore.DocumentSnapshot,
): LedgerTransactionView | undefined {
  if (!snapshot.exists) return undefined;
  const data = snapshot.data();
  if (data === undefined) return undefined;
  const householdId = text(data, "householdId");
  if (householdId === "") return undefined;
  const transactionType = data.transactionType === "income" ? "income" : "expense";
  const lifecycleState =
    data.lifecycleState === "deleted" || data.deletedAt !== undefined
      ? "deleted"
      : "active";
  return {
    transactionId: snapshot.id,
    householdId,
    transactionType,
    merchant: text(data, "merchant") || (transactionType === "income" ? "수입" : ""),
    memo: text(data, "memo"),
    amountInWon: numberValue(data, 0, "amountInWon", "amount"),
    categoryId: text(data, "categoryId", "category") || "etc",
    accountingDate: text(data, "accountingDate", "date"),
    localTime: text(data, "localTime", "time") || "00:00",
    cardDisplay: text(data, "cardDisplay") || "수동",
    cardType: data.cardType === "captured" ? "captured" : "manual",
    creatorMemberId: text(data, "creatorMemberId", "createdBy"),
    lifecycleState,
    aggregateVersion: Math.max(1, numberValue(data, 1, "aggregateVersion")),
    ...(data.notificationRequest !== undefined
      ? {
          notificationRequest: data.notificationRequest as {
            requesterMemberId: string;
            requestedAt: string;
          },
        }
      : {}),
  };
}

function transactionDocument(
  transaction: LedgerTransactionView,
  includeCreatedAt: boolean,
) {
  return {
    householdId: transaction.householdId,
    transactionType: transaction.transactionType,
    merchant: transaction.merchant,
    memo: transaction.memo,
    amountInWon: transaction.amountInWon,
    amount: transaction.amountInWon,
    categoryId: transaction.categoryId,
    category: transaction.categoryId,
    accountingDate: transaction.accountingDate,
    date: transaction.accountingDate,
    localTime: transaction.localTime,
    time: transaction.localTime,
    cardDisplay: transaction.cardDisplay,
    cardType: transaction.cardType,
    creatorMemberId: transaction.creatorMemberId,
    lifecycleState: transaction.lifecycleState,
    aggregateVersion: transaction.aggregateVersion,
    source: "manual",
    schemaVersion: 2,
    updatedAt: FieldValue.serverTimestamp(),
    ...(includeCreatedAt ? { createdAt: FieldValue.serverTimestamp() } : {}),
    ...(transaction.notificationRequest === undefined
      ? {}
      : { notificationRequest: transaction.notificationRequest }),
  };
}

export class FirebaseLedgerCommandRepository
  implements LedgerCommandRepository
{
  constructor(
    private readonly database: firestore.Firestore,
    private readonly householdId: string,
  ) {}

  async findReceipt(commandId: string): Promise<LedgerCommandResult | undefined> {
    const snapshot = await this.database
      .collection("commandReceipts")
      .doc(RECEIPT_CONTEXT)
      .collection("receipts")
      .doc(receiptId(this.householdId, commandId))
      .get();
    return snapshot.exists
      ? (snapshot.data()?.result as LedgerCommandResult | undefined)
      : undefined;
  }

  async findTransaction(
    transactionId: string,
  ): Promise<LedgerRepositoryReadResult<LedgerTransactionView | undefined>> {
    try {
      const [canonicalSnapshot, legacySnapshot] = await Promise.all([
        this.database
          .collection("households")
          .doc(this.householdId)
          .collection("ledgerTransactions")
          .doc(transactionId)
          .get(),
        this.database.collection(TRANSACTIONS).doc(transactionId).get(),
      ]);
      const transaction =
        mapTransaction(canonicalSnapshot) ?? mapTransaction(legacySnapshot);
      return {
        kind: "ready",
        value:
          transaction?.householdId === this.householdId ? transaction : undefined,
      };
    } catch (_error) {
      return { kind: "retryable-failure", code: "LEDGER_READ_UNAVAILABLE" };
    }
  }

  async listTransactions(
    householdId: string,
  ): Promise<LedgerRepositoryReadResult<readonly LedgerTransactionView[]>> {
    if (householdId !== this.householdId) {
      return { kind: "ready", value: [] };
    }
    try {
      const [canonical, legacy] = await Promise.all([
        this.database
          .collection("households")
          .doc(householdId)
          .collection("ledgerTransactions")
          .get(),
        this.database
          .collection(TRANSACTIONS)
          .where("householdId", "==", householdId)
          .get(),
      ]);
      const mapAll = (documents: readonly firestore.QueryDocumentSnapshot[]) =>
        documents
          .map(mapTransaction)
          .filter(
            (value): value is LedgerTransactionView => value !== undefined,
          );
      return {
        kind: "ready",
        value: mergeCanonicalLedgerTransactions({
          canonical: mapAll(canonical.docs),
          legacy: mapAll(legacy.docs),
        }),
      };
    } catch (_error) {
      return { kind: "retryable-failure", code: "LEDGER_READ_UNAVAILABLE" };
    }
  }

  async commit(input: Parameters<LedgerCommandRepository["commit"]>[0]) {
    if (
      input.householdId !== this.householdId ||
      input.transaction.householdId !== this.householdId
    ) {
      return { kind: "retryable-failure", code: "LEDGER_TENANT_SCOPE_MISMATCH" } as const;
    }
    const receiptReference = this.database
      .collection("commandReceipts")
      .doc(RECEIPT_CONTEXT)
      .collection("receipts")
      .doc(receiptId(this.householdId, input.commandId));
    const legacyTransactionReference = this.database
      .collection(TRANSACTIONS)
      .doc(input.transaction.transactionId);
    const canonicalTransactionReference = this.database
      .collection("households")
      .doc(this.householdId)
      .collection("ledgerTransactions")
      .doc(input.transaction.transactionId);
    const eventId = `${receiptId(this.householdId, input.commandId)}-ledger`;

    try {
      return await this.database.runTransaction(async (unitOfWork) => {
        const [receiptSnapshot, canonicalSnapshot, legacySnapshot] = await Promise.all([
          unitOfWork.get(receiptReference),
          unitOfWork.get(canonicalTransactionReference),
          unitOfWork.get(legacyTransactionReference),
        ]);
        if (receiptSnapshot.exists) return { kind: "success" } as const;

        const current =
          mapTransaction(canonicalSnapshot) ?? mapTransaction(legacySnapshot);
        if (
          current !== undefined &&
          current.householdId !== this.householdId
        ) {
          return {
            kind: "retryable-failure",
            code: "LEDGER_TENANT_SCOPE_MISMATCH",
          } as const;
        }
        const expectedVersion = input.transaction.aggregateVersion - 1;
        if (
          (expectedVersion === 0 && current !== undefined) ||
          (expectedVersion > 0 && current?.aggregateVersion !== expectedVersion)
        ) {
          return {
            kind: "retryable-failure",
            code: "LEDGER_CONCURRENT_WRITE",
          } as const;
        }

        unitOfWork.set(
          canonicalTransactionReference,
          transactionDocument(input.transaction, !canonicalSnapshot.exists),
          { merge: true },
        );
        unitOfWork.set(
          legacyTransactionReference,
          {
            ...transactionDocument(input.transaction, !legacySnapshot.exists),
            schemaVersion: 1,
          },
          { merge: true },
        );
        new FirebaseTransactionalOutbox(this.database).append(unitOfWork, {
          eventId,
          eventType: input.event.type as
            | "TransactionRecorded.v1"
            | "TransactionChanged.v1"
            | "TransactionDeleted.v1"
            | "HouseholdNotificationRequested.v1",
          householdId: this.householdId,
          aggregateId: input.transaction.transactionId,
          aggregateVersion: input.transaction.aggregateVersion,
          occurredAt: input.occurredAt,
          correlationId: input.commandId,
          causationId: input.commandId,
          payload: { ...input.event },
        });
        unitOfWork.create(receiptReference, {
          householdId: this.householdId,
          commandId: input.commandId,
          result: input.result,
          status: "completed",
          terminalAt: input.occurredAt,
          completedAt: input.occurredAt,
          expiresAt: terminalExpiry(input.occurredAt),
          schemaVersion: 1,
          createdAt: FieldValue.serverTimestamp(),
        });
        return { kind: "success" } as const;
      });
    } catch (_error) {
      return { kind: "retryable-failure", code: "LEDGER_COMMIT_FAILED" } as const;
    }
  }
}
