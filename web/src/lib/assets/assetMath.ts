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

export function calculateLoanMonthlyInterest(
  balance: number,
  annualInterestRate?: number
): number {
  const safeBalance = Math.max(0, balance || 0);
  const safeRate = Math.max(0, annualInterestRate || 0);

  if (safeBalance === 0 || safeRate === 0) {
    return 0;
  }

  return Math.round((safeBalance * safeRate) / 100 / 12);
}

export function calculateExpectedLoanPrincipalPayment(
  asset: Pick<
    Asset,
    'type' | 'currentBalance' | 'loanInterestRate' | 'loanMonthlyPaymentAmount' | 'loanRepaymentMethod'
  >
): number {
  if (asset.type !== 'loan') {
    return 0;
  }

  const balance = Math.max(0, asset.currentBalance || 0);
  const monthlyPayment = Math.max(0, asset.loanMonthlyPaymentAmount || 0);

  if (balance === 0 || monthlyPayment === 0) {
    return 0;
  }

  if (asset.loanRepaymentMethod === '원금균등상환') {
    return Math.min(balance, monthlyPayment);
  }

  const monthlyInterest = calculateLoanMonthlyInterest(balance, asset.loanInterestRate);
  return Math.min(balance, Math.max(0, monthlyPayment - monthlyInterest));
}

export function formatLoanMetaParts(
  asset: Pick<Asset, 'type' | 'loanInterestRate' | 'loanRepaymentMethod' | 'memo'>
): string[] {
  if (asset.type !== 'loan') {
    return asset.memo ? [asset.memo] : [];
  }

  const parts: string[] = [];

  if (typeof asset.loanInterestRate === 'number' && asset.loanInterestRate > 0) {
    parts.push(`금리 ${asset.loanInterestRate}%`);
  }

  if (asset.loanRepaymentMethod) {
    parts.push(asset.loanRepaymentMethod);
  }

  if (asset.memo) {
    parts.push(asset.memo);
  }

  return parts;
}
