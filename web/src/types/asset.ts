import { Timestamp } from 'firebase/firestore';

// 가족 구성원
export const FAMILY_MEMBERS = ['전체', '이민규', '이진선', '이지아'] as const;
export type FamilyMember = typeof FAMILY_MEMBERS[number];

// 자산 타입
export type AssetType = 'savings' | 'stock' | 'property' | 'gold';

// 자산 타입별 설정
export const ASSET_TYPE_CONFIG: Record<AssetType, {
  label: string;
  icon: string;
  color: string;
  subTypes: string[];
}> = {
  savings: {
    label: '예적금',
    icon: 'Building2',
    color: '#3B82F6',
    subTypes: ['예금', '적금', 'CMA'],
  },
  stock: {
    label: '주식',
    icon: 'CandlestickChart',
    color: '#10B981',
    subTypes: [], // 종목 검색으로 대체
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
    subTypes: [],
  },
};

// 자산 인터페이스
export interface Asset {
  id: string;
  householdId: string;
  name: string;              // "KB은행 예금", "삼성전자 주식"
  type: AssetType;
  subType?: string;          // "예금", "적금", "주식", "펀드", "코인", "부동산", "차량"
  owner?: string;            // 소유자 (가족 구성원)
  currentBalance: number;
  currency: string;          // 'KRW' (기본)
  memo?: string;
  icon?: string;             // Lucide 아이콘명
  color?: string;
  isActive: boolean;
  order: number;
  // 주식/ETF 전용 필드
  stockCode?: string;        // 종목코드 (예: "005930", "482730")
  quantity?: number;         // 보유 수량
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// 주식 검색 결과
export interface StockSearchResult {
  code: string;
  name: string;
}

// 주식 시세 정보
export interface StockPriceInfo {
  code: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  previousClose: number;
  currency: string;
}

// 자산 이력 인터페이스
export interface AssetHistoryEntry {
  id: string;
  householdId: string;
  assetId: string;
  balance: number;
  date: string;              // YYYY-MM-DD
  previousBalance: number;
  changeAmount: number;
  memo?: string;
  createdAt: Timestamp;
}

// 자산 생성 입력
export type AssetInput = Omit<Asset, 'id' | 'householdId' | 'createdAt' | 'updatedAt'>;

// 자산 이력 생성 입력
export type AssetHistoryInput = Omit<AssetHistoryEntry, 'id' | 'householdId' | 'createdAt'>;
