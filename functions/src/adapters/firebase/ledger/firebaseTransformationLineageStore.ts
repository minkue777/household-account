import { createHash } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

import type {
  TransformationLineageSelection,
  TransformationLineageStore,
} from "../../../contexts/household-finance/ledger/application/ports/transformationLineageStore";
import type {
  LedgerTransformationResult,
  LedgerTransformationState,
  LedgerTransformationTransaction,
} from "../../../contexts/household-finance/ledger/domain/model/transformationLineage";
import { FirebaseTransactionalOutbox } from "../outbox/firebaseTransactionalOutbox";
import { firestoreTtlAfter } from "../shared/firestoreTtl";

const RECEIPT_CONTEXT = "household-finance-ledger-transformation";

interface SelectedSnapshots {
  readonly canonical: readonly firestore.DocumentSnapshot[];
  readonly legacy: readonly firestore.DocumentSnapshot[];
  readonly claims: readonly firestore.DocumentSnapshot[];
}

interface MergedDisplaySnapshot {
  readonly merchant: string;
  readonly amount: number;
  readonly category: string;
  readonly memo?: string;
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function distinct(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value !== ""))];
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

function positiveInteger(
  data: FirebaseFirestore.DocumentData,
  field: string,
): number | undefined {
  const value = data[field];
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
    ? value
    : undefined;
}

function stringList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.filter(
    (item): item is string => typeof item === "string" && item !== "",
  );
  return values.length === 0 ? undefined : values;
}

function hasIncompleteLegacyMergeSnapshot(
  snapshot: firestore.DocumentSnapshot,
): boolean {
  if (!snapshot.exists) return false;
  const data = snapshot.data();
  return (
    data !== undefined &&
    data.lifecycleState !== "deleted" &&
    data.deletedAt === undefined &&
    Array.isArray(data.mergedFrom) &&
    data.mergedFrom.length > 0 &&
    stringList(data.mergeLeafIds) === undefined
  );
}

function authoritativeTransactionSnapshots(
  canonical: readonly firestore.DocumentSnapshot[],
  legacy: readonly firestore.DocumentSnapshot[],
): readonly firestore.DocumentSnapshot[] {
  const byId = new Map<string, firestore.DocumentSnapshot>();
  for (const snapshot of legacy) byId.set(snapshot.id, snapshot);
  for (const snapshot of canonical) byId.set(snapshot.id, snapshot);
  return [...byId.values()];
}

function mapTransaction(
  householdId: string,
  snapshot: firestore.DocumentSnapshot,
): LedgerTransformationTransaction | undefined {
  if (!snapshot.exists) return undefined;
  const data = snapshot.data();
  if (data === undefined || text(data, "householdId") !== householdId) {
    return undefined;
  }
  const lifecycleState =
    data.lifecycleState === "superseded"
      ? "superseded"
      : data.lifecycleState === "deleted" || data.deletedAt !== undefined
        ? "deleted"
        : "active";
  const source = text(data, "source") || "legacy";
  const cardDisplay = text(data, "cardDisplay", "cardLastFour", "cardName");
  const captureLineageId =
    text(data, "captureLineageId", "sourceFingerprint") ||
    `legacy:${snapshot.id}`;
  const localCurrencyType = text(data, "localCurrencyType");
  const mergeLeafIds = stringList(data.mergeLeafIds);
  const intermediateMergeHistoryIds = stringList(
    data.intermediateMergeHistoryIds,
  );
  const legacyMergeSnapshotPresent =
    Array.isArray(data.mergedFrom) && data.mergedFrom.length > 0;
  const splitGroupId = text(data, "splitGroupId");
  const splitIndex = positiveInteger(data, "splitIndex");
  const splitTotal = positiveInteger(data, "splitTotal");
  const splitOriginalId = text(data, "splitOriginalId");
  const derivedFromTransactionId = text(data, "derivedFromTransactionId");
  return {
    transactionId: snapshot.id,
    transactionType: data.transactionType === "income" ? "income" : "expense",
    lifecycleState,
    amountInWon: numberValue(data, 0, "amountInWon", "amount"),
    merchant: text(data, "merchant"),
    categoryId: text(data, "categoryId", "category") || "etc",
    memo: text(data, "memo"),
    accountingDate: text(data, "accountingDate", "date"),
    localTime: text(data, "localTime", "time") || "00:00",
    cardDisplay,
    cardType:
      text(data, "cardType") || (source === "manual" ? "manual" : "captured"),
    aggregateVersion: Math.max(1, numberValue(data, 1, "aggregateVersion")),
    provenance: {
      source,
      originChannel: text(data, "originChannel") || source,
      creatorMemberId: text(data, "creatorMemberId", "createdBy"),
      cardEvidence: text(data, "cardEvidence") || cardDisplay,
      captureLineageId,
      ...(localCurrencyType === "" ? {} : { localCurrencyType }),
    },
    ...(legacyMergeSnapshotPresent ? { legacyMergeSnapshotPresent: true } : {}),
    ...(mergeLeafIds === undefined ? {} : { mergeLeafIds }),
    ...(intermediateMergeHistoryIds === undefined
      ? {}
      : { intermediateMergeHistoryIds }),
    ...(splitGroupId === "" ? {} : { splitGroupId }),
    ...(splitIndex === undefined ? {} : { splitIndex }),
    ...(splitTotal === undefined ? {} : { splitTotal }),
    ...(splitOriginalId === "" ? {} : { splitOriginalId }),
    ...(derivedFromTransactionId === ""
      ? {}
      : { derivedFromTransactionId }),
  };
}

function mapClaim(
  householdId: string,
  snapshot: firestore.DocumentSnapshot,
): LedgerTransformationState["dedupClaims"][number] | undefined {
  if (!snapshot.exists) return undefined;
  const data = snapshot.data();
  if (data === undefined || text(data, "householdId") !== householdId) {
    return undefined;
  }
  const captureLineageId = text(data, "captureLineageId");
  if (captureLineageId === "") return undefined;
  return {
    fingerprint: text(data, "fingerprintHash", "fingerprint") || snapshot.id,
    captureLineageId,
    state: data.state === "cancelled" ? "cancelled" : "active",
  };
}

function signature(value: unknown): string {
  return JSON.stringify(value);
}

function keyedValuesEqual<T>(
  left: readonly T[],
  right: readonly T[],
  key: (value: T) => string,
): boolean {
  if (left.length !== right.length) return false;
  const rightByKey = new Map(right.map((value) => [key(value), value]));
  return left.every((value) => {
    const candidate = rightByKey.get(key(value));
    return candidate !== undefined && signature(candidate) === signature(value);
  });
}

function statesEqual(
  left: LedgerTransformationState,
  right: LedgerTransformationState,
): boolean {
  return (
    keyedValuesEqual(
      left.transactions,
      right.transactions,
      (transaction) => transaction.transactionId,
    ) &&
    keyedValuesEqual(
      left.dedupClaims,
      right.dedupClaims,
      (claim) => claim.captureLineageId,
    ) &&
    keyedValuesEqual(
      left.cancelledLineages,
      right.cancelledLineages,
      (entry) => entry.captureLineageId,
    )
  );
}

function mergedDisplaySnapshots(
  value: LedgerTransformationTransaction,
  transactions: ReadonlyMap<string, LedgerTransformationTransaction>,
): readonly MergedDisplaySnapshot[] | undefined {
  if (value.mergeLeafIds === undefined) return undefined;
  const leaves = value.mergeLeafIds.map((leafId) => transactions.get(leafId));
  if (leaves.some((leaf) => leaf === undefined)) return undefined;
  return (leaves as readonly LedgerTransformationTransaction[]).map((leaf) => ({
    merchant: leaf.merchant,
    amount: leaf.amountInWon,
    category: leaf.categoryId,
    ...(leaf.memo === "" ? {} : { memo: leaf.memo }),
  }));
}

function transactionDocument(
  householdId: string,
  value: LedgerTransformationTransaction,
  created: boolean,
  mergedFrom: readonly MergedDisplaySnapshot[] | undefined,
) {
  return {
    householdId,
    transactionType: value.transactionType,
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
    cardLastFour: value.cardDisplay,
    cardName: value.cardDisplay,
    cardType: value.cardType,
    aggregateVersion: value.aggregateVersion,
    source: value.provenance.source,
    originChannel: value.provenance.originChannel,
    creatorMemberId: value.provenance.creatorMemberId,
    createdBy: value.provenance.creatorMemberId,
    cardEvidence: value.provenance.cardEvidence,
    captureLineageId: value.provenance.captureLineageId,
    ...(value.provenance.localCurrencyType === undefined
      ? { localCurrencyType: FieldValue.delete() }
      : { localCurrencyType: value.provenance.localCurrencyType }),
    ...(value.mergeLeafIds === undefined
      ? { mergeLeafIds: FieldValue.delete() }
      : { mergeLeafIds: [...value.mergeLeafIds] }),
    ...(mergedFrom === undefined
      ? { mergedFrom: FieldValue.delete() }
      : { mergedFrom }),
    ...(value.intermediateMergeHistoryIds === undefined
      ? { intermediateMergeHistoryIds: FieldValue.delete() }
      : {
          intermediateMergeHistoryIds: [
            ...value.intermediateMergeHistoryIds,
          ],
        }),
    ...(value.splitGroupId === undefined
      ? {}
      : { splitGroupId: value.splitGroupId }),
    ...(value.splitIndex === undefined
      ? {}
      : { splitIndex: value.splitIndex }),
    ...(value.splitTotal === undefined
      ? {}
      : { splitTotal: value.splitTotal }),
    ...(value.splitOriginalId === undefined
      ? {}
      : { splitOriginalId: value.splitOriginalId }),
    ...(value.derivedFromTransactionId === undefined
      ? {}
      : { derivedFromTransactionId: value.derivedFromTransactionId }),
    schemaVersion: 2,
    updatedAt: FieldValue.serverTimestamp(),
    ...(created ? { createdAt: FieldValue.serverTimestamp() } : {}),
  };
}

export class FirebaseTransformationLineageStore
  implements TransformationLineageStore
{
  constructor(
    private readonly database: firestore.Firestore,
    private readonly householdId: string,
    private readonly occurredAt: string,
  ) {}

  private household() {
    return this.database.collection("households").doc(this.householdId);
  }

  private canonicalTransactions() {
    return this.household().collection("ledgerTransactions");
  }

  private legacyTransactions() {
    return this.database.collection("expenses");
  }

  private dedupClaims() {
    return this.household().collection("ledgerDedupKeys");
  }

  private receipt(operationKey: string) {
    return this.database
      .collection("commandReceipts")
      .doc(RECEIPT_CONTEXT)
      .collection("receipts")
      .doc(hash(`${this.householdId}\u0000${operationKey}`));
  }

  private stateFrom(snapshots: SelectedSnapshots): LedgerTransformationState {
    const transactions = new Map<string, LedgerTransformationTransaction>();
    for (const snapshot of snapshots.legacy) {
      const mapped = mapTransaction(this.householdId, snapshot);
      if (mapped !== undefined) transactions.set(mapped.transactionId, mapped);
    }
    for (const snapshot of snapshots.canonical) {
      const mapped = mapTransaction(this.householdId, snapshot);
      if (mapped !== undefined) {
        const legacy = transactions.get(mapped.transactionId);
        transactions.set(
          mapped.transactionId,
          {
            ...mapped,
            ...(legacy?.legacyMergeSnapshotPresent === true &&
            mapped.legacyMergeSnapshotPresent !== true
              ? { legacyMergeSnapshotPresent: true }
              : {}),
            ...(mapped.splitGroupId === undefined &&
            legacy?.splitGroupId !== undefined
              ? { splitGroupId: legacy.splitGroupId }
              : {}),
            ...(mapped.splitIndex === undefined && legacy?.splitIndex !== undefined
              ? { splitIndex: legacy.splitIndex }
              : {}),
            ...(mapped.splitTotal === undefined && legacy?.splitTotal !== undefined
              ? { splitTotal: legacy.splitTotal }
              : {}),
            ...(mapped.splitOriginalId === undefined &&
            legacy?.splitOriginalId !== undefined
              ? { splitOriginalId: legacy.splitOriginalId }
              : {}),
            ...(mapped.derivedFromTransactionId === undefined &&
            legacy?.derivedFromTransactionId !== undefined
              ? {
                  derivedFromTransactionId:
                    legacy.derivedFromTransactionId,
                }
              : {}),
          },
        );
      }
    }

    const claims = new Map<
      string,
      LedgerTransformationState["dedupClaims"][number]
    >();
    const cancelledLineages = new Map<
      string,
      LedgerTransformationState["cancelledLineages"][number]
    >();
    for (const snapshot of snapshots.claims) {
      const mapped = mapClaim(this.householdId, snapshot);
      if (mapped === undefined) continue;
      claims.set(mapped.captureLineageId, mapped);
      if (mapped.state !== "cancelled") continue;
      const data = snapshot.data() ?? {};
      cancelledLineages.set(mapped.captureLineageId, {
        captureLineageId: mapped.captureLineageId,
        fingerprint: mapped.fingerprint,
        cancelledAt: text(data, "cancelledAt"),
        receiptRef: text(data, "cancellationReceiptId", "receiptRef"),
      });
    }
    return {
      transactions: [...transactions.values()],
      dedupClaims: [...claims.values()],
      cancelledLineages: [...cancelledLineages.values()],
    };
  }

  private async readSelection(
    selection: TransformationLineageSelection,
  ): Promise<SelectedSnapshots> {
    const transactionIds = distinct(selection.transactionIds ?? []);
    const captureLineageIds = distinct(selection.captureLineageIds ?? []);
    const mergeLeafIds = distinct(selection.mergeLeafIds ?? []);
    const directReferences = [
      ...transactionIds.map((id) => this.canonicalTransactions().doc(id)),
      ...transactionIds.map((id) => this.legacyTransactions().doc(id)),
    ];
    const [
      directById,
      canonicalByCaptureLineage,
      canonicalBySourceFingerprint,
      legacyByCaptureLineage,
      legacyBySourceFingerprint,
      canonicalByMergeLeaf,
      legacyByMergeLeaf,
      claims,
    ] = await Promise.all([
      directReferences.length === 0
        ? Promise.resolve([])
        : this.database.getAll(...directReferences),
      Promise.all(
        captureLineageIds.map((id) =>
          this.canonicalTransactions().where("captureLineageId", "==", id).get(),
        ),
      ),
      Promise.all(
        captureLineageIds.map((id) =>
          this.canonicalTransactions().where("sourceFingerprint", "==", id).get(),
        ),
      ),
      Promise.all(
        captureLineageIds.map((id) =>
          this.legacyTransactions().where("captureLineageId", "==", id).get(),
        ),
      ),
      Promise.all(
        captureLineageIds.map((id) =>
          this.legacyTransactions().where("sourceFingerprint", "==", id).get(),
        ),
      ),
      Promise.all(
        mergeLeafIds.map((id) =>
          this.canonicalTransactions().where("mergeLeafIds", "array-contains", id).get(),
        ),
      ),
      Promise.all(
        mergeLeafIds.map((id) =>
          this.legacyTransactions().where("mergeLeafIds", "array-contains", id).get(),
        ),
      ),
      Promise.all(
        captureLineageIds.map((id) =>
          this.dedupClaims().where("captureLineageId", "==", id).get(),
        ),
      ),
    ]);
    const canonicalById = directById.slice(0, transactionIds.length);
    const legacyById = directById.slice(transactionIds.length);
    return {
      canonical: [
        ...canonicalById,
        ...canonicalByCaptureLineage.flatMap((snapshot) => snapshot.docs),
        ...canonicalBySourceFingerprint.flatMap((snapshot) => snapshot.docs),
        ...canonicalByMergeLeaf.flatMap((snapshot) => snapshot.docs),
      ],
      legacy: [
        ...legacyById,
        ...legacyByCaptureLineage.flatMap((snapshot) => snapshot.docs),
        ...legacyBySourceFingerprint.flatMap((snapshot) => snapshot.docs),
        ...legacyByMergeLeaf.flatMap((snapshot) => snapshot.docs),
      ],
      claims: claims.flatMap((snapshot) => snapshot.docs),
    };
  }

  private async readSelectionInTransaction(
    unitOfWork: firestore.Transaction,
    selection: TransformationLineageSelection,
  ): Promise<SelectedSnapshots> {
    const transactionIds = distinct(selection.transactionIds ?? []);
    const captureLineageIds = distinct(selection.captureLineageIds ?? []);
    const mergeLeafIds = distinct(selection.mergeLeafIds ?? []);
    const directReferences = [
      ...transactionIds.map((id) => this.canonicalTransactions().doc(id)),
      ...transactionIds.map((id) => this.legacyTransactions().doc(id)),
    ];
    const [
      directById,
      canonicalByCaptureLineage,
      canonicalBySourceFingerprint,
      legacyByCaptureLineage,
      legacyBySourceFingerprint,
      canonicalByMergeLeaf,
      legacyByMergeLeaf,
      claims,
    ] = await Promise.all([
      directReferences.length === 0
        ? Promise.resolve([])
        : unitOfWork.getAll(...directReferences),
      Promise.all(
        captureLineageIds.map((id) =>
          unitOfWork.get(
            this.canonicalTransactions().where("captureLineageId", "==", id),
          ),
        ),
      ),
      Promise.all(
        captureLineageIds.map((id) =>
          unitOfWork.get(
            this.canonicalTransactions().where("sourceFingerprint", "==", id),
          ),
        ),
      ),
      Promise.all(
        captureLineageIds.map((id) =>
          unitOfWork.get(
            this.legacyTransactions().where("captureLineageId", "==", id),
          ),
        ),
      ),
      Promise.all(
        captureLineageIds.map((id) =>
          unitOfWork.get(
            this.legacyTransactions().where("sourceFingerprint", "==", id),
          ),
        ),
      ),
      Promise.all(
        mergeLeafIds.map((id) =>
          unitOfWork.get(
            this.canonicalTransactions().where("mergeLeafIds", "array-contains", id),
          ),
        ),
      ),
      Promise.all(
        mergeLeafIds.map((id) =>
          unitOfWork.get(
            this.legacyTransactions().where("mergeLeafIds", "array-contains", id),
          ),
        ),
      ),
      Promise.all(
        captureLineageIds.map((id) =>
          unitOfWork.get(
            this.dedupClaims().where("captureLineageId", "==", id),
          ),
        ),
      ),
    ]);
    const canonicalById = directById.slice(0, transactionIds.length);
    const legacyById = directById.slice(transactionIds.length);
    return {
      canonical: [
        ...canonicalById,
        ...canonicalByCaptureLineage.flatMap((snapshot) => snapshot.docs),
        ...canonicalBySourceFingerprint.flatMap((snapshot) => snapshot.docs),
        ...canonicalByMergeLeaf.flatMap((snapshot) => snapshot.docs),
      ],
      legacy: [
        ...legacyById,
        ...legacyByCaptureLineage.flatMap((snapshot) => snapshot.docs),
        ...legacyBySourceFingerprint.flatMap((snapshot) => snapshot.docs),
        ...legacyByMergeLeaf.flatMap((snapshot) => snapshot.docs),
      ],
      claims: claims.flatMap((snapshot) => snapshot.docs),
    };
  }

  async findReceipt(
    operationKey: string,
  ): Promise<LedgerTransformationResult | undefined> {
    const snapshot = await this.receipt(operationKey).get();
    return snapshot.exists
      ? (snapshot.data()?.result as LedgerTransformationResult | undefined)
      : undefined;
  }

  async hasIncompleteLegacyMergeSnapshot(): Promise<boolean> {
    const [canonical, legacy] = await Promise.all([
      this.canonicalTransactions().get(),
      this.legacyTransactions()
        .where("householdId", "==", this.householdId)
        .get(),
    ]);
    return authoritativeTransactionSnapshots(
      canonical.docs,
      legacy.docs,
    ).some((snapshot) => hasIncompleteLegacyMergeSnapshot(snapshot));
  }

  async load(
    selection: TransformationLineageSelection,
  ): Promise<LedgerTransformationState> {
    return this.stateFrom(await this.readSelection(selection));
  }

  async commit(input: Parameters<TransformationLineageStore["commit"]>[0]) {
    try {
      return await this.database.runTransaction(async (unitOfWork) => {
        const receipt = this.receipt(input.operationKey);
        const receiptSnapshot = await unitOfWork.get(receipt);
        if (receiptSnapshot.exists) return { kind: "success" as const };

        if (input.requireCompleteMergeLineage === true) {
          const [canonical, legacy] = await Promise.all([
            unitOfWork.get(this.canonicalTransactions()),
            unitOfWork.get(
              this.legacyTransactions().where(
                "householdId",
                "==",
                this.householdId,
              ),
            ),
          ]);
          if (
            authoritativeTransactionSnapshots(
              canonical.docs,
              legacy.docs,
            ).some((snapshot) => hasIncompleteLegacyMergeSnapshot(snapshot))
          ) {
            return {
              kind: "contract-failure" as const,
              code: "RESTORATION_SNAPSHOT_INCOMPLETE" as const,
            };
          }
        }

        const baselineIds = new Set(
          input.baseline.transactions.map((transaction) => transaction.transactionId),
        );
        const newIds = input.state.transactions
          .filter((transaction) => !baselineIds.has(transaction.transactionId))
          .map((transaction) => transaction.transactionId);
        const guardedSelection: TransformationLineageSelection = {
          ...input.selection,
          transactionIds: distinct([
            ...(input.selection.transactionIds ?? []),
            ...newIds,
          ]),
        };
        const currentState = this.stateFrom(
          await this.readSelectionInTransaction(unitOfWork, guardedSelection),
        );
        if (!statesEqual(input.baseline, currentState)) {
          return { kind: "conflict" as const, code: "VERSION_MISMATCH" as const };
        }

        const current = new Map(
          currentState.transactions.map((transaction) => [
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

        const before = new Map(
          input.baseline.transactions.map((transaction) => [
            transaction.transactionId,
            transaction,
          ]),
        );
        const next = new Map(
          input.state.transactions.map((transaction) => [
            transaction.transactionId,
            transaction,
          ]),
        );
        const changed = [...next.values()].filter((value) => {
          const previous = before.get(value.transactionId);
          return previous === undefined || signature(previous) !== signature(value);
        });
        const removed = [...before.values()].filter(
          (value) => !next.has(value.transactionId),
        );

        const outbox = new FirebaseTransactionalOutbox(this.database);
        for (const value of changed) {
          const previous = current.get(value.transactionId);
          const data = transactionDocument(
            this.householdId,
            value,
            previous === undefined,
            mergedDisplaySnapshots(value, next),
          );
          unitOfWork.set(
            this.canonicalTransactions().doc(value.transactionId),
            data,
            { merge: true },
          );
          const legacyReference = this.legacyTransactions().doc(
            value.transactionId,
          );
          if (value.lifecycleState === "active") {
            unitOfWork.set(
              legacyReference,
              { ...data, schemaVersion: 1 },
              { merge: true },
            );
          } else {
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

        for (const value of removed) {
          unitOfWork.delete(this.canonicalTransactions().doc(value.transactionId));
          unitOfWork.delete(this.legacyTransactions().doc(value.transactionId));
          outbox.append(unitOfWork, {
            eventId: hash(
              `${this.householdId}\u0000${input.operationKey}\u0000TransactionDeleted.v1\u0000${value.transactionId}`,
            ),
            eventType: "TransactionDeleted.v1",
            householdId: this.householdId,
            aggregateId: value.transactionId,
            aggregateVersion: value.aggregateVersion + 1,
            occurredAt: this.occurredAt,
            correlationId: input.operationKey,
            causationId: input.operationKey,
            payload: { transactionId: value.transactionId },
          });
        }

        const baselineClaims = new Map(
          input.baseline.dedupClaims.map((claim) => [
            claim.captureLineageId,
            claim,
          ]),
        );
        for (const claim of input.state.dedupClaims) {
          const previous = baselineClaims.get(claim.captureLineageId);
          if (previous !== undefined && signature(previous) === signature(claim)) {
            continue;
          }
          const cancellation = input.state.cancelledLineages.find(
            (entry) => entry.captureLineageId === claim.captureLineageId,
          );
          unitOfWork.set(
            this.dedupClaims().doc(claim.fingerprint),
            {
              householdId: this.householdId,
              fingerprintHash: claim.fingerprint,
              captureLineageId: claim.captureLineageId,
              state: claim.state,
              ...(cancellation === undefined
                ? {
                    cancelledAt: FieldValue.delete(),
                    cancellationReceiptId: FieldValue.delete(),
                  }
                : {
                    cancelledAt: cancellation.cancelledAt,
                    cancellationReceiptId: cancellation.receiptRef,
                  }),
              schemaVersion: 1,
            },
            { merge: true },
          );
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
