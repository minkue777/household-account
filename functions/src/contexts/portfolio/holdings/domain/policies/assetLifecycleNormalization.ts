import type {
  LegacyValuationAsset,
  NormalizedValuationAsset,
} from "../model/dailyValuationRecovery";

export function normalizeValuationAssetLifecycle(
  asset: LegacyValuationAsset,
): NormalizedValuationAsset {
  return {
    ...asset,
    normalizedLifecycle:
      asset.lifecycleState ??
      (asset.legacyIsActive === false ? "deleted" : "active"),
  };
}
