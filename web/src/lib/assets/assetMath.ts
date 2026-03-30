import { ASSET_TYPE_CONFIG, Asset, AssetType } from '@/types/asset';

export function isLiabilityAsset(asset: Pick<Asset, 'type'>): boolean {
  return asset.type === 'loan';
}

export function getAssetSignedBalance(asset: Pick<Asset, 'type' | 'currentBalance'>): number {
  const balance = asset.currentBalance || 0;
  return isLiabilityAsset(asset) ? -Math.abs(balance) : balance;
}

export function getAssetChartBalance(asset: Pick<Asset, 'type' | 'currentBalance'>): number {
  return Math.abs(getAssetSignedBalance(asset));
}

export function sumSignedAssetBalances(assets: Array<Pick<Asset, 'type' | 'currentBalance'>>): number {
  return assets.reduce((sum, asset) => sum + getAssetSignedBalance(asset), 0);
}

export function sumSignedBalancesByAssetType(
  assets: Array<Pick<Asset, 'type' | 'currentBalance'>>
): Record<AssetType, number> {
  const totals = Object.keys(ASSET_TYPE_CONFIG).reduce((acc, type) => {
    acc[type as AssetType] = 0;
    return acc;
  }, {} as Record<AssetType, number>);

  assets.forEach((asset) => {
    totals[asset.type] += getAssetSignedBalance(asset);
  });

  return totals;
}
