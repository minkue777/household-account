import { createHash } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

import type { MonthlySplitLifecycleStore } from "../../../contexts/household-finance/ledger/application/ports/monthlySplitLifecycleStore";
import type {
  SplitLifecycleResult,
  SplitTransaction,
} from "../../../contexts/household-finance/ledger/domain/model/monthlySplitLifecycle";
import { mergeCanonicalLedgerTransactions } from "./migrationAwareLedgerUnion";
import { FirebaseTransactionalOutbox } from "../outbox/firebaseTransactionalOutbox";
import { firestoreTtlAfter } from "../shared/firestoreTtl";

const RECEIPT_CONTEXT = "household-finance-ledger-monthly-split";

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function receiptExpiry(instant: string) {
  return firestoreTtlAfter(instant);
}

function mapTransaction(
  snapshot: firestore.QueryDocumentSnapshot | firestore.DocumentSnapshot,
): SplitTransaction | undefined {
  if (!snapshot.exists) return undefined;
  const data = snapshot.data();
  if (
    data === undefined ||
    typeof data.householdId !== "string" ||
    (typeof data.amountInWon !== "number" && typeof data.amount !== "number") ||
    data.lifecycleState === "deleted"
  ) {
    return undefined;
  }
  const splitGroupValue = data.splitGroup;
  const splitGroup =
    typeof splitGroupValue === "object" && splitGroupValue !== null
      ? (splitGroupValue as SplitTransaction["splitGroup"])
      : typeof data.splitGroupId === "string"
        ? {
            groupId: data.splitGroupId,
            index: Number(data.splitIndex ?? 0),
            total: Number(data.splitTotal ?? 0),
            originalId: String(data.splitOriginalId ?? ""),
          }
        : undefined;
  return {
    transactionId: snapshot.id,
    householdId: data.householdId,
    transactionType: data.transactionType === "income" ? "income" : "expense",
    lifecycleState:
      data.lifecycleState === "superseded" ? "superseded" : "active",
    amountInWon: Number(data.amountInWon ?? data.amount),
    accountingDate: String(data.accountingDate ?? data.date ?? ""),
    merchant: String(data.merchant ?? ""),
    categoryId: String(data.categoryId ?? data.category ?? "etc"),
    memo: String(data.memo ?? ""),
    cardType: String(data.cardType ?? "manual"),
    cardDisplay: String(data.cardDisplay ?? "수동"),
    creatorMemberId: String(data.creatorMemberId ?? data.createdBy ?? ""),
    source: String(data.source ?? "manual"),
    originChannel: String(data.originChannel ?? "web"),
    aggregateVersion: Number(data.aggregateVersion ?? 1),
    ...(splitGroup === undefined ? {} : { splitGroup }),
  };
}

function documentData(transaction: SplitTransaction, isNew: boolean) {
  return {
    householdId: transaction.householdId,
    transactionType: transaction.transactionType,
    lifecycleState: transaction.lifecycleState,
    amountInWon: transaction.amountInWon,
    amount: transaction.amountInWon,
    accountingDate: transaction.accountingDate,
    date: transaction.accountingDate,
    merchant: transaction.merchant,
    categoryId: transaction.categoryId,
    category: transaction.categoryId,
    memo: transaction.memo,
    cardType: transaction.cardType,
    cardDisplay: transaction.cardDisplay,
    creatorMemberId: transaction.creatorMemberId,
    source: transaction.source,
    originChannel: transaction.originChannel,
    aggregateVersion: transaction.aggregateVersion,
    ...(transaction.splitGroup === undefined
      ? {}
      : {
          splitGroup: transaction.splitGroup,
          splitGroupId: transaction.splitGroup.groupId,
          splitIndex: transaction.splitGroup.index,
          splitTotal: transaction.splitGroup.total,
          splitOriginalId: transaction.splitGroup.originalId,
        }),
    schemaVersion: 2,
    updatedAt: FieldValue.serverTimestamp(),
    ...(isNew ? { createdAt: FieldValue.serverTimestamp() } : {}),
  };
}

function unionTransactions(
  canonical: readonly firestore.QueryDocumentSnapshot[],
  legacy: readonly firestore.QueryDocumentSnapshot[],
): readonly SplitTransaction[] {
  const mapAll = (documents: readonly firestore.QueryDocumentSnapshot[]) =>
    documents
      .map(mapTransaction)
      .filter((value): value is SplitTransaction => value !== undefined);
  return mergeCanonicalLedgerTransactions({
    canonical: mapAll(canonical),
    legacy: mapAll(legacy),
  });
}

export class FirebaseMonthlySplitLifecycleStore
  implements MonthlySplitLifecycleStore
{
  private loadedVersions = new Map<string, number>();

  constructor(
    private readonly database: firestore.Firestore,
    private readonly householdId: string,
    private readonly occurredAt: string,
  ) {}

  private receipt(operationKey: string) {
    return this.database
      .collection("commandReceipts")
      .doc(RECEIPT_CONTEXT)
      .collection("receipts")
      .doc(hash(`${this.householdId}\u0000${operationKey}`));
  }

  async findReceipt(
    operationKey: string,
  ): Promise<SplitLifecycleResult | undefined> {
    const snapshot = await this.receipt(operationKey).get();
    return snapshot.exists
      ? (snapshot.data()?.result as SplitLifecycleResult | undefined)
      : undefined;
  }

  async load(): Promise<readonly SplitTransaction[]> {
    const [canonical, legacy] = await Promise.all([
      this.database
        .collection("households")
        .doc(this.householdId)
        .collection("ledgerTransactions")
        .get(),
      this.database
        .collection("expenses")
        .where("householdId", "==", this.householdId)
        .get(),
    ]);
    const transactions = unionTransactions(canonical.docs, legacy.docs)
      .filter(
        (transaction): transaction is SplitTransaction =>
          transaction !== undefined && transaction.householdId === this.householdId,
      );
    this.loadedVersions = new Map(
      transactions.map((transaction) => [
        transaction.transactionId,
        transaction.aggregateVersion,
      ]),
    );
    return transactions;
  }

  async replaceAtomically(
    input: Parameters<MonthlySplitLifecycleStore["replaceAtomically"]>[0],
  ) {
    const householdReference = this.database
      .collection("households")
      .doc(this.householdId);
    try {
      return await this.database.runTransaction(async (transaction) => {
        const receiptReference = this.receipt(input.operationKey);
        const [receipt, canonical, legacy] = await Promise.all([
          transaction.get(receiptReference),
          transaction.get(householdReference.collection("ledgerTransactions")),
          transaction.get(
            this.database
              .collection("expenses")
              .where("householdId", "==", this.householdId),
          ),
        ]);
        if (receipt.exists) return { kind: "success" } as const;
        const current = new Map(
          unionTransactions(canonical.docs, legacy.docs)
            .map((value) => [value.transactionId, value]),
        );
        for (const [transactionId, expectedVersion] of this.loadedVersions) {
          if (current.get(transactionId)?.aggregateVersion !== expectedVersion) {
            return {
              kind: "retryable-failure",
              code: "LEDGER_CONCURRENT_WRITE",
            } as const;
          }
        }

        const next = new Map(
          input.transactions.map((value) => [value.transactionId, value]),
        );
        if (
          [...next.values()].some(
            (value) => value.householdId !== this.householdId,
          )
        ) {
          return {
            kind: "retryable-failure",
            code: "LEDGER_TENANT_SCOPE_MISMATCH",
          } as const;
        }
        for (const transactionId of current.keys()) {
          if (next.has(transactionId)) continue;
          transaction.delete(
            householdReference.collection("ledgerTransactions").doc(transactionId),
          );
          transaction.delete(this.database.collection("expenses").doc(transactionId));
        }
        for (const value of next.values()) {
          const canonicalReference = householdReference
            .collection("ledgerTransactions")
            .doc(value.transactionId);
          const legacyReference = this.database
            .collection("expenses")
            .doc(value.transactionId);
          transaction.set(
            canonicalReference,
            documentData(value, !current.has(value.transactionId)),
            { merge: true },
          );
          transaction.set(
            legacyReference,
            {
              ...documentData(value, !current.has(value.transactionId)),
              schemaVersion: 1,
            },
            { merge: true },
          );
        }

        for (const value of next.values()) {
          const previous = current.get(value.transactionId);
          if (previous !== undefined) continue;
          const eventId = hash(
            `${this.householdId}\u0000${input.operationKey}\u0000${value.transactionId}`,
          );
          new FirebaseTransactionalOutbox(this.database).append(transaction, {
            eventId,
            eventType: "TransactionRecorded.v1",
            householdId: this.householdId,
            aggregateId: value.transactionId,
            aggregateVersion: value.aggregateVersion,
            occurredAt: this.occurredAt,
            correlationId: input.operationKey,
            causationId: input.operationKey,
            payload: { transactionId: value.transactionId },
          });
        }
        transaction.create(receiptReference, {
          householdId: this.householdId,
          operationKey: input.operationKey,
          result: input.result,
          status: "completed",
          terminalAt: this.occurredAt,
          expiresAt: receiptExpiry(this.occurredAt),
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
