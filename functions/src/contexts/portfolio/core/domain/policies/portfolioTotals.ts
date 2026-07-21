export type PortfolioAssetType =
  | "savings"
  | "stock"
  | "crypto"
  | "property"
  | "gold"
  | "loan";

export type PortfolioAssetLifecycleState = "active" | "deleted" | "purging";

export type PortfolioOwnerRef =
  | { kind: "household" }
  | { kind: "profile"; profileId: string };

export interface PortfolioAssetFact {
  assetId: string;
  type: PortfolioAssetType;
  ownerRef: PortfolioOwnerRef;
  currentBalance: number;
  aggregateVersion: number;
  lifecycleState?: PortfolioAssetLifecycleState;
  legacyIsActive?: boolean;
}

export interface PortfolioTotals {
  total: number;
  financial: number;
  byType: Readonly<Record<PortfolioAssetType, number>>;
  byOwnerRefKey: Readonly<Record<string, number>>;
  sourceAssetVersions: Readonly<Record<string, number>>;
  calculatedAt: string;
}

export type PortfolioTotalsResult =
  | { kind: "success"; value: PortfolioTotals }
  | { kind: "validation-error"; code: "INVALID_MONEY"; assetId: string };

const FINANCIAL_TYPES = new Set<PortfolioAssetType>([
  "savings",
  "stock",
  "crypto",
  "gold",
]);

function isActive(asset: PortfolioAssetFact): boolean {
  if (asset.lifecycleState !== undefined) {
    return asset.lifecycleState === "active";
  }
  return asset.legacyIsActive !== false;
}

function ownerKey(ownerRef: PortfolioOwnerRef): string {
  return ownerRef.kind === "household"
    ? "household"
    : `profile:${ownerRef.profileId}`;
}

export function calculatePortfolioTotalsPolicy(input: {
  assets: readonly PortfolioAssetFact[];
  calculatedAt: string;
}): PortfolioTotalsResult {
  const byType: Record<PortfolioAssetType, number> = {
    savings: 0,
    stock: 0,
    crypto: 0,
    property: 0,
    gold: 0,
    loan: 0,
  };
  const byOwnerRefKey: Record<string, number> = {};
  const sourceAssetVersions: Record<string, number> = {};
  let total = 0;
  let financial = 0;

  for (const asset of input.assets) {
    if (!isActive(asset)) continue;
    if (!Number.isFinite(asset.currentBalance) || asset.currentBalance < 0) {
      return {
        kind: "validation-error",
        code: "INVALID_MONEY",
        assetId: asset.assetId,
      };
    }

    const signedBalance =
      asset.type === "loan" ? -asset.currentBalance : asset.currentBalance;
    total += signedBalance;
    byType[asset.type] += signedBalance;
    const key = ownerKey(asset.ownerRef);
    byOwnerRefKey[key] = (byOwnerRefKey[key] ?? 0) + signedBalance;
    sourceAssetVersions[asset.assetId] = asset.aggregateVersion;

    if (FINANCIAL_TYPES.has(asset.type)) {
      financial += signedBalance;
    }
  }

  return {
    kind: "success",
    value: {
      total,
      financial,
      byType,
      byOwnerRefKey,
      sourceAssetVersions,
      calculatedAt: input.calculatedAt,
    },
  };
}
