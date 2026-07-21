import { createHash } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

import type { TransformationLineageStore } from "../../../contexts/household-finance/ledger/application/ports/transformationLineageStore";
import type {
  LedgerTransformationResult,
  LedgerTransformationState,
  LedgerTransformationTransaction,
} from "../../../contexts/household-finance/ledger/domain/model/transformationLineage";
import { FirebaseTransactionalOutbox } from "../outbox/firebaseTransactionalOutbox";
import { firestoreTtlAfter } from "../shared/firestoreTtl";

const RECEIPT_CONTEXT = "household-finance-ledger-transformation";

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function text(
  data: FirebaseFirestore.DocumentData,
  ...fields: readonly string[]
): string {
  for (const field of fields) {
    const value = data[field];
    if (typeof value === "string") return value;
  }
  return "";
}

function numberValue(
  data: FirebaseFirestore.DocumentData,
  fallback: number,
  ...fields: readonly string[]
): number {
  for (const field of fields) {
    const value = data[field];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return fallback;
}

function stringList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.filter(
    (item): item is string => typeof item === "string" && item !== "",
  );
  return values.length === 0 ? undefined : values;
}

function mapTransaction(
  householdId: string,
  snapshot: firestore.QueryDocumentSnapshot,
): LedgerTransformationTransaction | undefined {
  const data = snapshot.data();
  if (text(data, "householdId") !== householdId) return undefined;
  const lifecycleState =
    data.lifecycleState === "superseded"
      ? "superseded"
      : data.lifecycleState === "deleted" || data.deletedAt !== undefined
        ? "deleted"
        : "active";
  const source = text(data, "source") || "legacy";
  const cardDisplay = text(data, "cardDisplay");
  const captureLineageId =
    text(data, "captureLineageId", "sourceFingerprint") ||
    `legacy:${snapshot.id}`;
  const localCurrencyType = text(data, "localCurrencyType");
  return {
    transactionId: snapshot.id,
    lifecycleState,
    amountInWon: numberValue(data, 0, "amountInWon", "amount"),
    merchant: text(data, "merchant"),
    categoryId: text(data, "categoryId", "category") || "etc",
    memo: text(data, "memo"),
    accountingDate: text(data, "accountingDate", "date"),
    localTime: text(data, "localTime", "time") || "00:00",
    cardDisplay,
    aggregateVersion: Math.max(1, numberValue(data, 1, "aggregateVersion")),
    provenance: {
      source,
      originChannel: text(data, "originChannel") || source,
      creatorMemberId: text(data, "creatorMemberId", "createdBy"),
      cardEvidence: text(data, "cardEvidence") || cardDisplay,
      captureLineageId,
      ...(localCurrencyType === "" ? {} : { localCurrencyType }),
    },
    ...(stringList(data.mergeLeafIds) === undefined
      ? {}
      : { mergeLeafIds: stringList(data.mergeLeafIds) }),
    ...(stringList(data.intermediateMergeHistoryIds) === undefined
      ? {}
      : {
          intermediateMergeHistoryIds: stringList(
            data.intermediateMergeHistoryIds,
          ),
        }),
  };
}

function signature(transaction: LedgerTransformationTransaction): string {
  return JSON.stringify(transaction);
}

function transactionDocument(
  householdId: string,
  value: LedgerTransformationTransaction,
  created: boolean,
) {
  return {
    householdId,
    transactionType: "expense",
    lifecycleState: value.lifecycleState,
    amountInWon: value.amountInWon,
    amount: value.amountInWon,
    merchant: value.merchant,
    categoryId: value.categoryId,
    category: value.categoryId,
    memo: value.memo,
    accountingDate: value.accountingDate,
    date: value.accountingDate,
    localTime: value.localTime,
    time: value.localTime,
    cardDisplay: value.cardDisplay,
    aggregateVersion: value.aggregateVersion,
    source: value.provenance.source,
    originChannel: value.provenance.originChannel,
    creatorMemberId: value.provenance.creatorMemberId,
    cardEvidence: value.provenance.cardEvidence,
    captureLineageId: value.provenance.captureLineageId,
    ...(value.provenance.localCurrencyType === undefined
      ? {}
      : { localCurrencyType: value.provenance.localCurrencyType }),
    ...(value.mergeLeafIds === undefined
      ? { mergeLeafIds: FieldValue.delete() }
      : { mergeLeafIds: [...value.mergeLeafIds] }),
    ...(value.intermediateMergeHistoryIds === undefined
      ? { intermediateMergeHistoryIds: FieldValue.delete() }
      : {
          intermediateMergeHistoryIds: [
            ...value.intermediateMergeHistoryIds,
          ],
        }),
    schemaVersion: 2,
    updatedAt: FieldValue.serverTimestamp(),
    ...(created ? { createdAt: FieldValue.serverTimestamp() } : {}),
  };
}

export class FirebaseTransformationLineageStore
  implements TransformationLineageStore
{
  private loaded = new Map<string, LedgerTransformationTransaction>();

  constructor(
    private readonly database: firestore.Firestore,
    private readonly householdId: string,
    private readonly occurredAt: string,
  ) {}

  private household() {
    return this.database.collection("households").doc(this.householdId);
  }

  private receipt(operationKey: string) {
    return this.database
      .collection("commandReceipts")
      .doc(RECEIPT_CONTEXT)
      .collection("receipts")
      .doc(hash(`${this.householdId}\u0000${operationKey}`));
  }

  private union(
    canonical: readonly firestore.QueryDocumentSnapshot[],
    legacy: readonly firestore.QueryDocumentSnapshot[],
  ): readonly LedgerTransformationTransaction[] {
    const values = new Map<string, LedgerTransformationTransaction>();
    for (const snapshot of legacy) {
      const mapped = mapTransaction(this.householdId, snapshot);
      if (mapped !== undefined) values.set(mapped.transactionId, mapped);
    }
    for (const snapshot of canonical) {
      const mapped = mapTransaction(this.householdId, snapshot);
      if (mapped !== undefined) values.set(mapped.transactionId, mapped);
    }
    return [...values.values()];
  }

  async findReceipt(
    operationKey: string,
  ): Promise<LedgerTransformationResult | undefined> {
    const snapshot = await this.receipt(operationKey).get();
    return snapshot.exists
      ? (snapshot.data()?.result as LedgerTransformationResult | undefined)
      : undefined;
  }

  async load(): Promise<LedgerTransformationState> {
    const [canonical, legacy] = await Promise.all([
      this.household().collection("ledgerTransactions").get(),
      this.database
        .collection("expenses")
        .where("householdId", "==", this.householdId)
        .get(),
    ]);
    const transactions = this.union(canonical.docs, legacy.docs);
    this.loaded = new Map(
      transactions.map((transaction) => [transaction.transactionId, transaction]),
    );
    return { transactions, dedupClaims: [], cancelledLineages: [] };
  }

  async commit(input: Parameters<TransformationLineageStore["commit"]>[0]) {
    try {
      return await this.database.runTransaction(async (unitOfWork) => {
        const receipt = this.receipt(input.operationKey);
        const [receiptSnapshot, canonical, legacy] = await Promise.all([
          unitOfWork.get(receipt),
          unitOfWork.get(this.household().collection("ledgerTransactions")),
          unitOfWork.get(
            this.database
              .collection("expenses")
              .where("householdId", "==", this.householdId),
          ),
        ]);
        if (receiptSnapshot.exists) return { kind: "success" as const };

        const current = new Map(
          this.union(canonical.docs, legacy.docs).map((transaction) => [
            transaction.transactionId,
            transaction,
          ]),
        );
        for (const [transactionId, expectedVersion] of Object.entries(
          input.expectedVersions,
        )) {
          if (current.get(transactionId)?.aggregateVersion !== expectedVersion) {
            return { kind: "conflict" as const, code: "VERSION_MISMATCH" as const };
          }
        }
        const next = new Map(
          input.state.transactions.map((transaction) => [
            transaction.transactionId,
            transaction,
          ]),
        );
        const changed = [...next.values()].filter((value) => {
          const before = this.loaded.get(value.transactionId);
          return before === undefined || signature(before) !== signature(value);
        });
        for (const value of changed) {
          const loaded = this.loaded.get(value.transactionId);
          const latest = current.get(value.transactionId);
          if (
            (loaded === undefined && latest !== undefined) ||
            (loaded !== undefined &&
              latest?.aggregateVersion !== loaded.aggregateVersion)
          ) {
            return { kind: "conflict" as const, code: "VERSION_MISMATCH" as const };
          }
        }

        const outbox = new FirebaseTransactionalOutbox(this.database);
        for (const value of changed) {
          const previous = current.get(value.transactionId);
          const data = transactionDocument(
            this.householdId,
            value,
            previous === undefined,
          );
          unitOfWork.set(
            this.household()
              .collection("ledgerTransactions")
              .doc(value.transactionId),
            data,
            { merge: true },
          );
          const legacyReference = this.database
            .collection("expenses")
            .doc(value.transactionId);
          if (value.lifecycleState === "active") {
            unitOfWork.set(
              legacyReference,
              { ...data, schemaVersion: 1 },
              { merge: true },
            );
          } else {
            // Legacy Web read model에는 활성 거래만 projection합니다.
            unitOfWork.delete(legacyReference);
          }
          const eventType =
            previous === undefined
              ? ("TransactionRecorded.v1" as const)
              : value.lifecycleState === "deleted"
                ? ("TransactionDeleted.v1" as const)
                : ("TransactionChanged.v1" as const);
          outbox.append(unitOfWork, {
            eventId: hash(
              `${this.householdId}\u0000${input.operationKey}\u0000${eventType}\u0000${value.transactionId}`,
            ),
            eventType,
            householdId: this.householdId,
            aggregateId: value.transactionId,
            aggregateVersion: value.aggregateVersion,
            occurredAt: this.occurredAt,
            correlationId: input.operationKey,
            causationId: input.operationKey,
            payload: { transactionId: value.transactionId },
          });
        }
        unitOfWork.create(receipt, {
          householdId: this.householdId,
          operationKey: input.operationKey,
          result: input.result,
          status: "completed",
          terminalAt: this.occurredAt,
          expiresAt: firestoreTtlAfter(this.occurredAt),
          schemaVersion: 1,
          createdAt: FieldValue.serverTimestamp(),
        });
        return { kind: "success" as const };
      });
    } catch {
      return {
        kind: "retryable-failure" as const,
        code: "LEDGER_UOW_COMMIT_FAILED" as const,
      };
    }
  }
}
