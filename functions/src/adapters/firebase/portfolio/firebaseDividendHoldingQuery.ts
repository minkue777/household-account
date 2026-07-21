import type * as firestore from "firebase-admin/firestore";

import type {
  DividendHoldingQuery,
  DividendHoldingPositionView,
  DividendHoldingTargetView,
  DividendPositionHistoryView,
} from "../../../contexts/portfolio/holdings/public";

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function iso(value: unknown): string {
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof value.toDate === "function"
  ) {
    return (value.toDate as () => Date)().toISOString();
  }
  return "1970-01-01T00:00:00.000Z";
}

function explicitKrxEtfPosition(
  snapshot: firestore.QueryDocumentSnapshot,
): DividendHoldingPositionView | undefined {
  const data = snapshot.data();
  if (
    data.market !== "KRX" ||
    data.instrumentType !== "etf" ||
    data.lifecycleState !== "active"
  ) {
    return undefined;
  }
  const householdId = text(data.householdId);
  const assetId = text(data.assetId);
  const instrumentCode = text(data.instrumentCode);
  const instrumentName = text(data.instrumentName);
  const quantity = Number(data.quantity);
  const aggregateVersion = Number(data.aggregateVersion);
  if (
    householdId === undefined ||
    assetId === undefined ||
    instrumentCode === undefined ||
    instrumentName === undefined ||
    !Number.isFinite(quantity) ||
    quantity < 0 ||
    !Number.isSafeInteger(aggregateVersion) ||
    aggregateVersion < 1
  ) {
    return undefined;
  }
  return {
    householdId,
    assetId,
    positionId: snapshot.id,
    instrument: {
      market: "KRX",
      instrumentType: "ETF",
      code: instrumentCode.toLocaleUpperCase("en-US"),
      name: instrumentName,
      currency: "KRW",
    },
    quantity,
    aggregateVersion,
    updatedAt: iso(data.updatedAt),
  };
}

function groupTargets(
  positions: readonly DividendHoldingPositionView[],
): readonly DividendHoldingTargetView[] {
  const grouped = new Map<
    string,
    { target: DividendHoldingTargetView; assetIds: Set<string> }
  >();
  for (const position of positions) {
    const targetId = `${position.householdId}:${position.instrument.code}`;
    const current = grouped.get(targetId) ?? {
      target: {
        targetId,
        householdId: position.householdId,
        instrument: position.instrument,
        sourceAssetIds: [],
      },
      assetIds: new Set<string>(),
    };
    current.assetIds.add(position.assetId);
    grouped.set(targetId, current);
  }
  return [...grouped.values()]
    .map(({ target, assetIds }) => ({
      ...target,
      sourceAssetIds: [...assetIds].sort(),
    }))
    .sort((left, right) => left.targetId.localeCompare(right.targetId));
}

function historyView(
  snapshot: firestore.QueryDocumentSnapshot,
): DividendPositionHistoryView | undefined {
  const data = snapshot.data();
  const instrument =
    typeof data.instrument === "object" && data.instrument !== null
      ? (data.instrument as Record<string, unknown>)
      : undefined;
  if (
    instrument?.market !== "KRX" ||
    !["ETF", "etf"].includes(String(instrument.instrumentType))
  ) {
    return undefined;
  }
  const householdId = text(data.householdId);
  const assetId = text(data.assetId);
  const positionId = text(data.positionId);
  const instrumentCode = text(instrument.code);
  const snapshotDate = text(data.snapshotDate);
  const observedAt = text(data.observedAt);
  const sourceVersion =
    text(data.sourceVersion) ??
    (typeof data.sourceVersion === "number" && Number.isFinite(data.sourceVersion)
      ? String(data.sourceVersion)
      : undefined);
  const quantity = Number(data.quantity);
  if (
    householdId === undefined ||
    assetId === undefined ||
    positionId === undefined ||
    instrumentCode === undefined ||
    snapshotDate === undefined ||
    observedAt === undefined ||
    sourceVersion === undefined ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(snapshotDate) ||
    !Number.isFinite(quantity) ||
    quantity < 0
  ) {
    return undefined;
  }
  return {
    householdId,
    assetId,
    positionId,
    instrumentCode: instrumentCode.toLocaleUpperCase("en-US"),
    snapshotDate,
    quantity,
    observedAt,
    sourceVersion,
  };
}

/**
 * Holdings 공개 query의 Firebase adapter입니다. Dividends는 이 adapter를 통해서만
 * canonical Position과 보존된 Position history를 읽습니다.
 */
export class FirebaseDividendHoldingQuery implements DividendHoldingQuery {
  constructor(private readonly database: firestore.Firestore) {}

  async listActiveKrxEtfTargets(input: {
    readonly cursor?: string;
    readonly limit: number;
  }) {
    const snapshot = await this.database.collectionGroup("positions").get();
    const targets = groupTargets(
      snapshot.docs.flatMap((document) => {
        const position = explicitKrxEtfPosition(document);
        return position === undefined ? [] : [position];
      }),
    );
    const cursor = input.cursor;
    const start =
      cursor === undefined
        ? 0
        : targets.findIndex(({ targetId }) => targetId > cursor);
    if (start < 0) return { items: [] };
    const items = targets.slice(start, start + input.limit);
    const last = items.at(-1)?.targetId;
    return {
      items,
      ...(last !== undefined && start + items.length < targets.length
        ? { nextCursor: last }
        : {}),
    };
  }

  async listPositionHistory(input: {
    readonly householdId: string;
    readonly sourceAssetIds: readonly string[];
    readonly instrumentCode: string;
  }): Promise<readonly DividendPositionHistoryView[]> {
    if (input.sourceAssetIds.length === 0) return [];
    const snapshot = await this.database
      .collectionGroup("positionHistory")
      .where("householdId", "==", input.householdId)
      .get();
    const assetIds = new Set(input.sourceAssetIds);
    return snapshot.docs
      .flatMap((document) => {
        const observation = historyView(document);
        return observation === undefined ? [] : [observation];
      })
      .filter(
        ({ assetId, instrumentCode }) =>
          assetIds.has(assetId) &&
          instrumentCode === input.instrumentCode.toLocaleUpperCase("en-US"),
      )
      .sort(
        (left, right) =>
          left.assetId.localeCompare(right.assetId) ||
          left.snapshotDate.localeCompare(right.snapshotDate) ||
          left.observedAt.localeCompare(right.observedAt),
      );
  }
}
