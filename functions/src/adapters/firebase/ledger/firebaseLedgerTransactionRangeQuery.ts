import type * as firestore from "firebase-admin/firestore";

import type {
  LedgerTransactionRangeItem,
  LedgerTransactionRangeQuery,
  LedgerTransactionRangeQueryPort,
} from "../../../contexts/household-finance/ledger/application/ports/ledgerTransactionRangeQuery";

function text(
  data: FirebaseFirestore.DocumentData,
  ...fields: readonly string[]
): string | undefined {
  for (const field of fields) {
    const value = data[field];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
}

function finiteNumber(
  data: FirebaseFirestore.DocumentData,
  ...fields: readonly string[]
): number | undefined {
  for (const field of fields) {
    const value = data[field];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : fallback;
}

function mergedFrom(value: unknown): LedgerTransactionRangeItem["mergedFrom"] {
  if (!Array.isArray(value)) return undefined;
  const items = value.flatMap((candidate) => {
    if (typeof candidate !== "object" || candidate === null) return [];
    const record = candidate as Record<string, unknown>;
    if (
      typeof record.merchant !== "string" ||
      typeof record.amount !== "number" ||
      !Number.isFinite(record.amount) ||
      typeof record.category !== "string"
    ) {
      return [];
    }
    return [{
      merchant: record.merchant,
      amount: record.amount,
      category: record.category,
      ...(typeof record.memo === "string" ? { memo: record.memo } : {}),
    }];
  });
  return items.length === 0 ? undefined : items;
}

function isVisible(data: FirebaseFirestore.DocumentData): boolean {
  return data.lifecycleState !== "deleted" && data.deletedAt === undefined;
}

function mapTransaction(
  snapshot: firestore.QueryDocumentSnapshot,
): LedgerTransactionRangeItem | undefined {
  const data = snapshot.data();
  if (!isVisible(data)) return undefined;
  const date = text(data, "accountingDate", "date");
  const merchant = text(data, "merchant");
  const amount = finiteNumber(data, "amountInWon", "amount");
  if (date === undefined || merchant === undefined || amount === undefined) {
    return undefined;
  }
  const source = text(data, "source");
  const cardType = text(data, "cardType") ?? (source === "manual" ? "manual" : undefined);
  const cardDisplay =
    cardType === "manual" || source === "manual"
      ? "수동"
      : text(data, "cardDisplay", "cardLastFour");
  const lineage = mergedFrom(data.mergedFrom);
  const splitGroupId = text(data, "splitGroupId");
  return {
    id: snapshot.id,
    aggregateVersion: positiveInteger(data.aggregateVersion, 1),
    date,
    ...(text(data, "localTime", "time") === undefined
      ? {}
      : { time: text(data, "localTime", "time") }),
    merchant,
    amount,
    transactionType: data.transactionType === "income" ? "income" : "expense",
    category: (text(data, "categoryId", "category") ?? "etc").toLowerCase(),
    ...(cardType === undefined ? {} : { cardType: cardType.toLowerCase() }),
    ...(cardDisplay === undefined ? {} : { cardDisplay }),
    ...(typeof data.memo === "string" ? { memo: data.memo } : {}),
    ...(lineage === undefined ? {} : { mergedFrom: lineage }),
    ...(splitGroupId === undefined ? {} : { splitGroupId }),
    ...(typeof data.splitIndex === "number" ? { splitIndex: data.splitIndex } : {}),
    ...(typeof data.splitTotal === "number" ? { splitTotal: data.splitTotal } : {}),
  };
}

export class FirebaseLedgerTransactionRangeQuery
  implements LedgerTransactionRangeQueryPort
{
  constructor(private readonly database: firestore.Firestore) {}

  async list(
    query: LedgerTransactionRangeQuery,
  ): Promise<readonly LedgerTransactionRangeItem[]> {
    const snapshot = await this.database
      .collection("expenses")
      .where("householdId", "==", query.householdId)
      .get();
    return snapshot.docs
      .map(mapTransaction)
      .filter(
        (item): item is LedgerTransactionRangeItem =>
          item !== undefined &&
          item.date >= query.startDate &&
          item.date <= query.endDate &&
          item.transactionType === query.transactionType,
      )
      .sort((left, right) =>
        right.date.localeCompare(left.date) ||
        (right.time ?? "").localeCompare(left.time ?? "") ||
        right.id.localeCompare(left.id),
      );
  }
}
