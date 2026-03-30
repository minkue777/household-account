import { Asset } from '@/types/asset';

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
