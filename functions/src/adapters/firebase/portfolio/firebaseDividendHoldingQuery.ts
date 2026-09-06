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
  catalogEtfCodes?: ReadonlySet<string>,
): DividendHoldingPositionView | undefined {
  const data = snapshot.data();
  const instrumentCode = text(data.instrumentCode);
  const normalizedCode = instrumentCode?.toLocaleUpperCase("en-US");
  if (
    data.market !== "KRX" ||
    (data.instrumentType !== "etf" &&
      (normalizedCode === undefined || !catalogEtfCodes?.has(normalizedCode))) ||
    data.lifecycleState !== "active"
  ) {
    return undefined;
  }
  const householdId = text(data.householdId);
  const assetId = text(data.assetId);
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

function needsCatalogClassification(
  snapshot: firestore.QueryDocumentSnapshot,
): boolean {
  const data = snapshot.data();
  return (
    data.market === "KRX" &&
    data.lifecycleState === "active" &&
    data.instrumentType !== "etf" &&
    text(data.instrumentCode) !== undefined
  );
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
  if (instrument?.market !== "KRX") {
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
  constructor(
    private readonly database: firestore.Firestore,
    private readonly resolveKrxEtfCodes?: () => Promise<ReadonlySet<string>>,
  ) {}

  async listActiveKrxEtfTargets(input: {
    readonly cursor?: string;
    readonly limit: number;
  }) {
    let query = this.database.collectionGroup("positions")
      .where("market", "==", "KRX").where("lifecycleState", "==", "active")
      .orderBy("householdId").orderBy("instrumentCode");
    if (input.cursor !== undefined) {
      const separator = input.cursor.indexOf(":");
      if (separator < 1) throw new Error("INVALID_DIVIDEND_CURSOR");
      query = query.startAfter(input.cursor.slice(0, separator), input.cursor.slice(separator + 1));
    }
    const snapshot = await query.limit(input.limit).get();
    const last = snapshot.docs.at(-1)?.data();
    // A target is a household/instrument group. Complete the boundary group so
    // its quantity evidence never loses positions at a database page boundary.
    const boundary = last === undefined ? [] : (await this.database.collectionGroup("positions")
      .where("market", "==", "KRX").where("lifecycleState", "==", "active")
      .where("householdId", "==", last.householdId)
      .where("instrumentCode", "==", last.instrumentCode).get()).docs;
    const documents = [...new Map([...snapshot.docs, ...boundary].map(document => [document.ref.path, document])).values()];
    const catalogEtfCodes =
      this.resolveKrxEtfCodes !== undefined &&
      documents.some(needsCatalogClassification)
        ? await this.resolveKrxEtfCodes()
        : undefined;
    const positions = documents.flatMap((document) => {
        const position = explicitKrxEtfPosition(document, catalogEtfCodes);
        return position === undefined ? [] : [position];
      });
    const activeParents = new Set<string>();
    const parents = new Map(positions.map(position => [`${position.householdId}/${position.assetId}`, position]));
    await Promise.all([...parents].map(async ([key, position]) => {
      const canonical = await this.database.collection("households").doc(position.householdId).collection("assets").doc(position.assetId).get();
      if (canonical.exists) {
        if (canonical.data()?.lifecycleState === "active" && canonical.data()?.deletedAt === undefined) activeParents.add(key);
        return;
      }
      const legacy = await this.database.collection("assets").doc(position.assetId).get();
      const data = legacy.data();
      if (data?.householdId === position.householdId && data.isActive !== false && data.lifecycleState !== "deleted" && data.deletedAt === undefined) activeParents.add(key);
    }));
    const targets = groupTargets(positions.filter(position => activeParents.has(`${position.householdId}/${position.assetId}`)));
    return {
      items: targets,
      ...(last !== undefined && snapshot.size === input.limit
        ? { nextCursor: `${last.householdId}:${last.instrumentCode}` }
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
      .where("instrument.code", "==", input.instrumentCode.toLocaleUpperCase("en-US"))
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
