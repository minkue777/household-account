import type * as firestore from "firebase-admin/firestore";

import { safeIntegerAmount } from "../../../../operations/migration/public";
import {
  candidateDraft,
  createdAndUpdated,
  legacySchemaInScope,
  lifecycle,
  migrationIssue,
  numberValue,
  positiveInteger,
  text,
  type MigrationDocumentData,
  type RuntimeMigrationCandidateDraft,
  type RuntimeMigrationCollectorIssue,
  type RuntimeMigrationCollectorResult,
  type RuntimeMigrationCollectorScope,
} from "./runtimeMigrationCollectorContract";

const VALID_MARKETS = new Set(["KRX", "US", "KOFIA_FUND"]);

export interface PortfolioPositionRuntimeMigrationCollectorInput
  extends RuntimeMigrationCollectorScope {
  readonly legacyAssets: readonly firestore.QueryDocumentSnapshot[];
  readonly legacyStocks: readonly firestore.QueryDocumentSnapshot[];
  readonly legacyCrypto: readonly firestore.QueryDocumentSnapshot[];
  readonly canonicalAssets: ReadonlyMap<string, MigrationDocumentData>;
  readonly loadExistingPosition: (
    assetId: string,
    positionId: string,
  ) => Promise<MigrationDocumentData | undefined>;
}

export async function collectPortfolioPositionRuntimeMigration(
  input: PortfolioPositionRuntimeMigrationCollectorInput,
): Promise<RuntimeMigrationCollectorResult> {
  const drafts: RuntimeMigrationCandidateDraft[] = [];
  const unresolved: RuntimeMigrationCollectorIssue[] = [];
  const sources = [
    ...input.legacyStocks.map((snapshot) => ({ snapshot, kind: "stock" as const })),
    ...input.legacyCrypto.map((snapshot) => ({ snapshot, kind: "crypto" as const })),
  ];
  const targets = await Promise.all(
    sources.map(async ({ snapshot }) => {
      const assetId =
        text(snapshot.data(), "assetId") ||
        input.mappings.positionAssets?.[snapshot.id] ||
        "";
      return {
        sourcePath: snapshot.ref.path,
        assetId,
        existing:
          assetId === ""
            ? undefined
            : await input.loadExistingPosition(assetId, snapshot.id),
      };
    }),
  );
  const targetBySourcePath = new Map(
    targets.map((target) => [target.sourcePath, target]),
  );

  for (const { snapshot, kind } of sources) {
    const data = snapshot.data();
    if (!legacySchemaInScope(data)) {
      unresolved.push(
        migrationIssue({
          code: "SOURCE_DOCUMENT_INVALID",
          sourceCollection: snapshot.ref.parent.id,
          reference: snapshot.ref.path,
          detailCode: "SOURCE_SCHEMA_OUTSIDE_SCOPE",
        }),
      );
      continue;
    }
    const target = targetBySourcePath.get(snapshot.ref.path)!;
    if (target.assetId === "") {
      unresolved.push(
        migrationIssue({
          code: "POSITION_ASSET_MAPPING_REQUIRED",
          sourceCollection: snapshot.ref.parent.id,
          reference: snapshot.ref.path,
          requiredManifestField: "positionAssets",
        }),
      );
      continue;
    }
    if (
      !input.canonicalAssets.has(target.assetId) &&
      !input.legacyAssets.some(({ id }) => id === target.assetId)
    ) {
      unresolved.push(
        migrationIssue({
          code: "POSITION_ASSET_MAPPING_REQUIRED",
          sourceCollection: snapshot.ref.parent.id,
          reference: snapshot.ref.path,
          requiredManifestField: "positionAssets",
          detailCode: "ASSET_NOT_IN_SCOPE",
        }),
      );
      continue;
    }
    if (target.existing !== undefined) continue;
    const rawMarket = text(data, "market");
    const market =
      kind === "crypto"
        ? "UPBIT_KRW"
        : VALID_MARKETS.has(rawMarket)
          ? rawMarket
          : input.mappings.positionMarkets?.[snapshot.id];
    if (market === undefined) {
      unresolved.push(
        migrationIssue({
          code: "POSITION_MARKET_MAPPING_REQUIRED",
          sourceCollection: snapshot.ref.parent.id,
          reference: snapshot.ref.path,
          requiredManifestField: "positionMarkets",
        }),
      );
      continue;
    }
    const code = text(
      data,
      kind === "stock" ? "stockCode" : "marketCode",
    ).toUpperCase();
    const name = text(data, kind === "stock" ? "stockName" : "coinName");
    if (code === "" || name === "") {
      unresolved.push(
        migrationIssue({
          code: "SOURCE_DOCUMENT_INVALID",
          sourceCollection: snapshot.ref.parent.id,
          reference: snapshot.ref.path,
          detailCode: "POSITION_INSTRUMENT_MISSING",
        }),
      );
      continue;
    }
    const quantity = Math.max(0, numberValue(data, 0, "quantity"));
    const averagePriceInWon = Math.max(
      0,
      numberValue(data, 0, "averagePriceInWon", "avgPrice"),
    );
    const currentPrice = Math.max(0, numberValue(data, 0, "currentPrice"));
    const amountInWon = safeIntegerAmount(
      Math.round(quantity * (currentPrice || averagePriceInWon)),
    );
    const timestamps = createdAndUpdated(data, input.plannedAt);
    const currency = text(data, "currency") === "USD" ? "USD" : "KRW";
    const instrumentType =
      kind === "crypto"
        ? "crypto"
        : ["stock", "etf", "etn", "fund"].includes(
              text(data, "instrumentType"),
            )
          ? text(data, "instrumentType")
          : "stock";
    drafts.push(
      candidateDraft(snapshot, {
        targetPath: `${input.householdPath}/assets/${target.assetId}/positions/${snapshot.id}`,
        targetData: {
          positionId: snapshot.id,
          householdId: input.scope.householdId,
          assetId: target.assetId,
          positionKind: kind,
          instrumentCode: code,
          instrumentName: name,
          instrumentType,
          market,
          currency,
          ...(kind === "stock"
            ? { holdingType: text(data, "holdingType") || "stock" }
            : {}),
          instrument: {
            market,
            instrumentType: instrumentType.toUpperCase(),
            code,
            name,
            currency,
            priceScale: Math.max(1, numberValue(data, 1, "priceScale")),
          },
          quantity,
          averagePriceInWon,
          priceScale: Math.max(1, numberValue(data, 1, "priceScale")),
          ...(currentPrice > 0
            ? {
                lastQuote: {
                  priceInWon: currentPrice,
                  observedAt: text(data, "quoteAsOf") || timestamps.updatedAt,
                  provider: "legacy-observed",
                },
              }
            : {}),
          lifecycleState: lifecycle(data),
          aggregateVersion: Math.max(
            1,
            positiveInteger(data, 1, "aggregateVersion"),
          ),
          schemaVersion: 1,
          ...timestamps,
        },
        action: "create",
        amountInWon,
        sourceAmountInWon: amountInWon,
        logicalCollection: "position",
      }),
    );
  }

  return { drafts, unresolved };
}
