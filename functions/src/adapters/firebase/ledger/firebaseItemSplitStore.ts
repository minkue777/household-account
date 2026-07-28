import { createHash } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

import type { ItemSplitStore } from "../../../contexts/household-finance/ledger/application/ports/itemSplitStore";
import type {
  ItemSplitResult,
  ItemSplitTransaction,
} from "../../../contexts/household-finance/ledger/domain/model/itemSplitRestoration";
import { mergeCanonicalLedgerTransactions } from "./migrationAwareLedgerUnion";
import { FirebaseTransactionalOutbox } from "../outbox/firebaseTransactionalOutbox";
import { firestoreTtlAfter } from "../shared/firestoreTtl";

const RECEIPT_CONTEXT = "household-finance-ledger-item-split";

interface TransactionMetadata {
  readonly transactionType: "expense" | "income";
  readonly accountingDate: string;
  readonly localTime: string;
  readonly cardType: string;
  readonly cardDisplay: string;
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function expiry(instant: string) {
  return firestoreTtlAfter(instant);
}

function mapTransaction(
  snapshot: firestore.QueryDocumentSnapshot | firestore.DocumentSnapshot,
): ItemSplitTransaction | undefined {
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
  return {
    transactionId: snapshot.id,
    householdId: data.householdId,
    lifecycleState:
      data.lifecycleState === "superseded" ? "superseded" : "active",
    merchant: String(data.merchant ?? ""),
    amountInWon: Number(data.amountInWon ?? data.amount),
    categoryId: String(data.categoryId ?? data.category ?? ""),
    memo: String(data.memo ?? ""),
    source: String(data.source ?? "legacy"),
    originChannel: String(data.originChannel ?? "legacy"),
    creatorMemberId: String(data.creatorMemberId ?? data.createdBy ?? ""),
    cardEvidence: String(data.cardEvidence ?? data.cardDisplay ?? ""),
    captureLineageId: String(
      data.captureLineageId ?? data.sourceFingerprint ?? "",
    ),
    aggregateVersion: Number(data.aggregateVersion ?? 1),
    ...(typeof data.derivedFromTransactionId === "string"
      ? { derivedFromTransactionId: data.derivedFromTransactionId }
      : {}),
  };
}

function metadata(
  snapshot: firestore.QueryDocumentSnapshot | firestore.DocumentSnapshot,
): TransactionMetadata | undefined {
  if (!snapshot.exists) return undefined;
  const data = snapshot.data();
  if (data === undefined) return undefined;
  return {
    transactionType: data.transactionType === "income" ? "income" : "expense",
    accountingDate: String(data.accountingDate ?? data.date ?? ""),
    localTime: String(data.localTime ?? data.time ?? ""),
    cardType: String(data.cardType ?? "captured"),
    cardDisplay: String(data.cardDisplay ?? ""),
  };
}

function mapped(
  documents: readonly firestore.DocumentSnapshot[],
): readonly ItemSplitTransaction[] {
  return documents
    .map(mapTransaction)
    .filter((value): value is ItemSplitTransaction => value !== undefined);
}

export class FirebaseItemSplitStore implements ItemSplitStore {
  private loadedVersions = new Map<string, number>();
  private loadedTransactions = new Map<string, ItemSplitTransaction>();
  private loadedMetadata = new Map<string, TransactionMetadata>();

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

  async findReceipt(operationKey: string): Promise<ItemSplitResult | undefined> {
    const snapshot = await this.receipt(operationKey).get();
    return snapshot.exists
      ? (snapshot.data()?.result as ItemSplitResult | undefined)
      : undefined;
  }

  async load(input: Parameters<ItemSplitStore["load"]>[0]) {
    const household = this.database
      .collection("households")
      .doc(this.householdId);
    const [
      canonicalSource,
      legacySource,
      canonicalDerived,
      legacyDerived,
    ] = await Promise.all([
      household.collection("ledgerTransactions").doc(input.sourceId).get(),
      this.database.collection("expenses").doc(input.sourceId).get(),
      input.includeDerived
        ? household
          .collection("ledgerTransactions")
          .where("derivedFromTransactionId", "==", input.sourceId)
          .get()
        : Promise.resolve(undefined),
      input.includeDerived
        ? this.database
          .collection("expenses")
          .where("derivedFromTransactionId", "==", input.sourceId)
          .get()
        : Promise.resolve(undefined),
    ]);
    const canonicalDocuments: firestore.DocumentSnapshot[] = [
      canonicalSource,
      ...(canonicalDerived?.docs ?? []),
    ];
    const legacyDocuments: firestore.DocumentSnapshot[] = [
      legacySource,
      ...(legacyDerived?.docs ?? []),
    ];
    const transactions = mergeCanonicalLedgerTransactions({
      canonical: mapped(canonicalDocuments),
      legacy: mapped(legacyDocuments),
    }).filter((value) => value.householdId === this.householdId);
    this.loadedTransactions = new Map(
      transactions.map((value) => [value.transactionId, value]),
    );
    this.loadedVersions = new Map(
      transactions.map((value) => [value.transactionId, value.aggregateVersion]),
    );
    this.loadedMetadata = new Map();
    for (const document of [...legacyDocuments, ...canonicalDocuments]) {
      const value = metadata(document);
      if (
        value !== undefined &&
        mapTransaction(document)?.householdId === this.householdId
      ) {
        this.loadedMetadata.set(document.id, value);
      }
    }
    return { transactions, dedupClaims: [] };
  }

  async replaceAtomically(input: Parameters<ItemSplitStore["replaceAtomically"]>[0]) {
    const household = this.database.collection("households").doc(this.householdId);
    const next = new Map(
      input.snapshot.transactions.map((value) => [value.transactionId, value]),
    );
    if (
      [...next.values()].some(
        (value) => value.householdId !== this.householdId,
      )
    ) {
      return {
        kind: "RetryableFailure",
        code: "LEDGER_TENANT_SCOPE_MISMATCH",
      } as const;
    }
    const affectedIds = new Set<string>();
    for (const transactionId of this.loadedTransactions.keys()) {
      if (!next.has(transactionId)) affectedIds.add(transactionId);
    }
    for (const [transactionId, value] of next) {
      const previous = this.loadedTransactions.get(transactionId);
      if (
        previous === undefined ||
        previous.aggregateVersion !== value.aggregateVersion
      ) {
        affectedIds.add(transactionId);
      }
    }

    try {
      return await this.database.runTransaction(async (unitOfWork) => {
        const receipt = this.receipt(input.operationKey);
        const receiptSnapshot = await unitOfWork.get(receipt);
        if (receiptSnapshot.exists) return { kind: "success" } as const;

        const affected = [...affectedIds];
        const currentSnapshots = await Promise.all(
          affected.flatMap((transactionId) => [
            unitOfWork.get(
              household.collection("ledgerTransactions").doc(transactionId),
            ),
            unitOfWork.get(
              this.database.collection("expenses").doc(transactionId),
            ),
          ]),
        );
        const currentById = new Map<string, ItemSplitTransaction>();
        affected.forEach((transactionId, index) => {
          const current = mergeCanonicalLedgerTransactions({
            canonical: mapped([currentSnapshots[index * 2]]),
            legacy: mapped([currentSnapshots[index * 2 + 1]]),
          })[0];
          if (current !== undefined) currentById.set(transactionId, current);
        });
        for (const transactionId of affected) {
          const expectedVersion = this.loadedVersions.get(transactionId);
          const currentVersion =
            currentById.get(transactionId)?.aggregateVersion;
          if (currentVersion !== expectedVersion) {
            return {
              kind: "RetryableFailure",
              code: "LEDGER_CONCURRENT_WRITE",
            } as const;
          }
        }

        const metadataFor = (value: ItemSplitTransaction) => {
          const sourceId = value.derivedFromTransactionId ?? value.transactionId;
          return (
            this.loadedMetadata.get(sourceId) ?? {
              transactionType: "expense" as const,
              accountingDate: "",
              localTime: "",
              cardType: "captured",
              cardDisplay: value.cardEvidence,
            }
          );
        };
        for (const transactionId of affected) {
          const value = next.get(transactionId);
          const canonicalReference = household
            .collection("ledgerTransactions")
            .doc(transactionId);
          const legacyReference = this.database
            .collection("expenses")
            .doc(transactionId);
          if (value === undefined) {
            unitOfWork.delete(canonicalReference);
            unitOfWork.delete(legacyReference);
            continue;
          }
          const extra = metadataFor(value);
          const data = {
            householdId: value.householdId,
            transactionType: extra.transactionType,
            lifecycleState: value.lifecycleState,
            merchant: value.merchant,
            amountInWon: value.amountInWon,
            amount: value.amountInWon,
            categoryId: value.categoryId,
            category: value.categoryId,
            memo: value.memo,
            accountingDate: extra.accountingDate,
            date: extra.accountingDate,
            localTime: extra.localTime,
            time: extra.localTime,
            cardType: extra.cardType,
            cardDisplay: extra.cardDisplay,
            creatorMemberId: value.creatorMemberId,
            source: value.source,
            originChannel: value.originChannel,
            cardEvidence: value.cardEvidence,
            captureLineageId: value.captureLineageId,
            aggregateVersion: value.aggregateVersion,
            ...(value.derivedFromTransactionId === undefined
              ? {}
              : { derivedFromTransactionId: value.derivedFromTransactionId }),
            schemaVersion: 2,
            updatedAt: FieldValue.serverTimestamp(),
            ...(this.loadedTransactions.has(value.transactionId)
              ? {}
              : { createdAt: FieldValue.serverTimestamp() }),
          };
          unitOfWork.set(
            canonicalReference,
            data,
            { merge: true },
          );
          unitOfWork.set(
            legacyReference,
            { ...data, schemaVersion: 1 },
            { merge: true },
          );
        }
        const outbox = new FirebaseTransactionalOutbox(this.database);
        for (const [transactionId, currentValue] of this.loadedTransactions) {
          if (!affectedIds.has(transactionId) || next.has(transactionId)) continue;
          outbox.append(unitOfWork, {
            eventId: hash(
              `${this.householdId}\u0000${input.operationKey}\u0000deleted\u0000${currentValue.transactionId}`,
            ),
            eventType: "TransactionDeleted.v1",
            householdId: this.householdId,
            aggregateId: currentValue.transactionId,
            aggregateVersion: currentValue.aggregateVersion,
            occurredAt: this.occurredAt,
            correlationId: input.operationKey,
            causationId: input.operationKey,
            payload: { transactionId: currentValue.transactionId },
          });
        }
        for (const transactionId of affected) {
          const value = next.get(transactionId);
          if (value === undefined) continue;
          const previous = this.loadedTransactions.get(transactionId);
          if (
            previous !== undefined &&
            previous.aggregateVersion === value.aggregateVersion
          ) {
            continue;
          }
          const eventType =
            previous === undefined
              ? ("TransactionRecorded.v1" as const)
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
          expiresAt: expiry(this.occurredAt),
          schemaVersion: 1,
          createdAt: FieldValue.serverTimestamp(),
        });
        return { kind: "success" } as const;
      });
    } catch (_error) {
      return { kind: "RetryableFailure", code: "LEDGER_COMMIT_FAILED" } as const;
    }
  }
}
