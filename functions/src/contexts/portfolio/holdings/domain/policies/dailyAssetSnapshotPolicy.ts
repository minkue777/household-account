import type {
  AssetSnapshotIntentView,
  DailyValuationTarget,
} from "../model/dailyAssetValuation";

export function buildDailyAssetSnapshotIntent(input: {
  localDate: string;
  createdAt: string;
  targets: readonly DailyValuationTarget[];
  valuesByTargetId: Readonly<Record<string, number>>;
  previousScopes?: {
    byType: Readonly<Record<string, number>>;
    byOwnerRefKey: Readonly<Record<string, number>>;
  };
}): AssetSnapshotIntentView {
  const byType: Record<string, number> = Object.fromEntries(
    Object.keys(input.previousScopes?.byType ?? {}).map((key) => [key, 0]),
  );
  const byOwnerRefKey: Record<string, number> = Object.fromEntries(
    Object.keys(input.previousScopes?.byOwnerRefKey ?? {}).map((key) => [key, 0]),
  );
  let total = 0;

  for (const target of input.targets) {
    const value = input.valuesByTargetId[target.targetId];
    if (value === undefined) continue;
    total += value;
    byType[target.assetType] = (byType[target.assetType] ?? 0) + value;
    byOwnerRefKey[target.ownerRefKey] =
      (byOwnerRefKey[target.ownerRefKey] ?? 0) + value;
  }

  return {
    localDate: input.localDate,
    total,
    financial: total,
    byType,
    byOwnerRefKey,
    createdAt: input.createdAt,
  };
}
