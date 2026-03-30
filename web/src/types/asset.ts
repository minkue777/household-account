import { Timestamp } from 'firebase/firestore';

export const FAMILY_MEMBERS = ['전체', '이민규', '이진선', '이지아'] as const;
export type FamilyMember = typeof FAMILY_MEMBERS[number];

export const ASSET_OWNERS = ['가구', '이민규', '이진선', '이지아'] as const;
export type AssetOwner = typeof ASSET_OWNERS[number];

export type AssetType = 'savings' | 'stock' | 'crypto' | 'property' | 'gold' | 'loan';

export const LOAN_REPAYMENT_METHODS = [
  '원리금균등상환',
  '원금균등상환',
  '만기일시상환',
] as const;
export type LoanRepaymentMethod = typeof LOAN_REPAYMENT_METHODS[number];

export const ASSET_TYPE_CONFIG: Record<
  AssetType,
  {
    label: string;
    icon: string;
    color: string;
    subTypes: string[];
  }
> = {
  savings: {
    label: '예적금',
    icon: 'WalletMinimal',
    color: '#3B82F6',
    subTypes: ['예금', '적금', 'CMA'],
  },
  stock: {
    label: '주식',
    icon: 'ChartCandlestick',
    color: '#10B981',
    subTypes: [],
  },
  crypto: {
    label: '코인',
    icon: 'Bitcoin',
    color: '#F97316',
    subTypes: [],
  },
  property: {
    label: '부동산',
    icon: 'Home',
    color: '#8B5CF6',
    subTypes: [],
  },
  gold: {
    label: '금',
    icon: 'Coins',
    color: '#F59E0B',
    subTypes: ['실물 금', '금 ETF'],
  },
  loan: {
    label: '대출',
    icon: 'HandCoins',
    color: '#EF4444',
    subTypes: ['신용대출', '주택담보대출', '전세대출'],
  },
};

export interface Asset {
  id: string;
  householdId: string;
  name: string;
  type: AssetType;
  subType?: string;
  owner?: string;
  currentBalance: number;
  recurringContributionAmount?: number;
  recurringContributionDay?: number;
  lastAutoContributionMonth?: string;
  loanInterestRate?: number;
  loanRepaymentMethod?: LoanRepaymentMethod;
  loanMonthlyPaymentAmount?: number;
  loanPaymentDay?: number;
  lastAutoRepaymentMonth?: string;
  costBasis?: number;
  initialInvestment?: number;
  currency: string;
  memo?: string;
  icon?: string;
  color?: string;
  isActive: boolean;
  order: number;
  stockCode?: string;
  quantity?: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface StockSearchResult {
  code: string;
  name: string;
}

export interface StockPriceInfo {
  code: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  previousClose: number;
  currency: string;
}

export interface CryptoSearchResult {
  code: string;
  name: string;
}

export interface CryptoPriceInfo {
  code: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  previousClose: number;
  currency: string;
}

export interface AssetHistoryEntry {
  id: string;
  householdId: string;
  assetId: string;
  balance: number;
  date: string;
  changeAmount: number;
  memo?: string;
  createdAt: Timestamp;
}

export interface StockHolding {
  id: string;
  assetId: string;
  householdId: string;
  stockCode: string;
  stockName: string;
  quantity: number;
  avgPrice?: number;
  currentPrice?: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CryptoHolding {
  id: string;
  assetId: string;
  householdId: string;
  marketCode: string;
  coinName: string;
  quantity: number;
  avgPrice?: number;
  currentPrice?: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type AssetInput = Omit<Asset, 'id' | 'householdId' | 'createdAt' | 'updatedAt'>;
export type AssetHistoryInput = Omit<AssetHistoryEntry, 'id' | 'householdId' | 'createdAt'>;
export type StockHoldingInput = Omit<StockHolding, 'id' | 'householdId' | 'createdAt' | 'updatedAt'>;
export type CryptoHoldingInput = Omit<CryptoHolding, 'id' | 'householdId' | 'createdAt' | 'updatedAt'>;

function normalizeSubTypeValue(value?: string) {
  return (value || '').toLowerCase().replace(/\s+/g, '');
}

export function normalizeGoldSubType(subType?: string) {
  const normalized = normalizeSubTypeValue(subType);

  if (!normalized) {
    return '';
  }

  if (normalized === '금etf' || normalized === 'etf' || normalized === '주식') {
    return '금 ETF';
  }

  if (normalized === '실물금' || normalized === '현물') {
    return '실물 금';
  }

  return subType || '';
}

export function isGoldEtfSubType(subType?: string) {
  return normalizeGoldSubType(subType) === '금 ETF';
}
