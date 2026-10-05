import type { AssetOwnerRef, AssetType } from '@/types/asset';

export interface PortfolioConfirmedAsset {
  assetId: string;
  householdId: string;
  name: string;
  type: AssetType;
  subType?: string;
  ownerRef: AssetOwnerRef;
  currency: 'KRW' | 'USD';
  currentBalance: number;
  costBasis?: number;
  memo: string;
  order: number;
  lifecycleState: 'active' | 'deleted' | 'purging';
  aggregateVersion: number;
  deletedAt?: string;
  initialInvestment?: number;
  quantity?: number;
  stockCode?: string;
  icon?: string;
  color?: string;
  automation: {
    recurringContributionAmount: number;
    recurringContributionDay: number;
    lastAutoContributionMonth: string;
    loanInterestRate: number;
    loanRepaymentMethod: string;
    loanMonthlyPaymentAmount: number;
    loanPaymentDay: number;
    lastAutoRepaymentMonth: string;
  };
}

export interface PortfolioConfirmedPosition {
  positionId: string;
  householdId: string;
  assetId: string;
  positionKind: 'stock' | 'crypto';
  instrumentCode: string;
  instrumentName: string;
  instrumentType: 'stock' | 'etf' | 'etn' | 'fund' | 'bond' | 'cash' | 'manual' | 'crypto';
  market: 'KRX' | 'US' | 'KOFIA_FUND' | 'UPBIT_KRW' | 'UNRESOLVED';
  exchange?: 'KOSPI' | 'KOSDAQ' | 'KONEX' | 'NASDAQ' | 'NYSE' | 'AMEX';
  currency: 'KRW' | 'USD';
  holdingType?: 'stock' | 'bond' | 'cash' | 'manual';
  quantity: number;
  averagePriceInWon: number;
  priceScale: number;
  lastQuote?: { priceInWon: number; observedAt: string; provider: string };
  quoteAsOf?: string;
  aggregateVersion: number;
  lifecycleState: 'active' | 'deleted';
}

export interface PortfolioCommandConfirmation {
  schemaVersion: 1;
  occurredAt: string;
  assets: readonly PortfolioConfirmedAsset[];
  positions: readonly PortfolioConfirmedPosition[];
}

/** 과거 receipt는 confirmation이 없다. 버전이나 commit 시각을 합성하지 않는다. */
export interface PortfolioMutationResult {
  confirmation?: PortfolioCommandConfirmation;
}
