import {
  collection,
  doc,
  query,
  where,
  onSnapshot,
  getDocs,
  getDoc,
  QueryDocumentSnapshot,
  DocumentData,
  orderBy,
  db,
  timestampToDate,
} from '@/platform/read-model/firestoreReadModel';
import {
  Asset,
  AssetHistoryEntry,
  AssetInput,
  AssetType,
  CryptoHolding,
  CryptoHoldingInput,
  StockHolding,
  StockHoldingInput,
  isGoldEtfSubType,
} from '@/types/asset';
import { requireClientSessionScope } from '@/composition/clientSessionScope';
import { portfolioCommands } from '@/features/portfolio/application/portfolioCommands';
import { formatLocalDate } from './utils/date';
import { ALL_MEMBERS_OPTION } from './assets/memberOptions';
import {
  getAssetSignedBalance,
  sumSignedBalancesByAssetType,
} from './assets/assetMath';
import {
  calculateHoldingCostBasis,
  calculateHoldingValue,
} from './assets/holdingValuation';

const ASSETS_COLLECTION = 'assets';
const HISTORY_COLLECTION = 'asset_history';
const HOLDINGS_COLLECTION = 'stock_holdings';
const CRYPTO_HOLDINGS_COLLECTION = 'crypto_holdings';

/**
 * 현재 가구 키 가져오기
 */
function getHouseholdId(): string {
  return requireClientSessionScope().householdId;
}

/**
 * Firestore 문서를 Asset 객체로 변환
 */
function mapDocToAsset(docSnap: QueryDocumentSnapshot<DocumentData>): Asset {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    householdId: data.householdId,
    name: data.name,
    type: data.type,
    subType: data.subType,
    owner: data.owner,
    ownerRef:
      data.ownerRef?.kind === 'household'
        ? { kind: 'household' }
        : data.ownerRef?.kind === 'profile' && typeof data.ownerRef.profileId === 'string'
          ? { kind: 'profile', profileId: data.ownerRef.profileId }
          : undefined,
    currentBalance: data.currentBalance || 0,
    recurringContributionAmount: data.recurringContributionAmount || 0,
    recurringContributionDay: data.recurringContributionDay || 0,
    lastAutoContributionMonth: data.lastAutoContributionMonth || '',
    loanInterestRate: data.loanInterestRate || 0,
    loanRepaymentMethod: data.loanRepaymentMethod || '',
    loanMonthlyPaymentAmount: data.loanMonthlyPaymentAmount || 0,
    loanPaymentDay: data.loanPaymentDay || 0,
    lastAutoRepaymentMonth: data.lastAutoRepaymentMonth || '',
    costBasis: data.costBasis,
    initialInvestment: data.initialInvestment,
    currency: data.currency || 'KRW',
    memo: data.memo,
    icon: data.icon,
    color: data.color,
    isActive: data.isActive !== false,
    order: data.order || 0,
    stockCode: data.stockCode,
    quantity: data.quantity,
    createdAt: timestampToDate(data.createdAt) ?? new Date(0),
    updatedAt: timestampToDate(data.updatedAt) ?? new Date(0),
  };
}

function extractPhysicalGoldQuantity(asset: Pick<Asset, 'quantity' | 'memo'>): number {
  if (typeof asset.quantity === 'number' && Number.isFinite(asset.quantity) && asset.quantity > 0) {
    return asset.quantity;
  }

  const match = asset.memo?.match(/(\d+(?:\.\d+)?)\s*돈/);
  if (!match) {
    return 0;
  }

  const parsed = parseFloat(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Firestore 문서를 AssetHistoryEntry 객체로 변환
 */
function mapDocToHistory(docSnap: QueryDocumentSnapshot<DocumentData>): AssetHistoryEntry {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    householdId: data.householdId,
    assetId: data.assetId,
    balance: data.balance,
    date: data.date,
    changeAmount: data.changeAmount,
    memo: data.memo,
    createdAt: timestampToDate(data.createdAt) ?? new Date(0),
  };
}

/**
 * 자산 추가
 */
export async function addAsset(input: AssetInput): Promise<string> {
  return portfolioCommands.createAsset(getHouseholdId(), input);
}

/**
 * 자산 수정
 */
export async function updateAsset(id: string, data: Partial<Asset>): Promise<void> {
  await portfolioCommands.updateAsset(getHouseholdId(), id, data);
}

/**
 * 자산 순서 일괄 업데이트
 */
export async function updateAssetOrders(assetOrders: { id: string; order: number }[]): Promise<void> {
  await portfolioCommands.reorderAssets(getHouseholdId(), assetOrders);
}

/**
 * 자산 논리 삭제 (이력과 보유 내역은 운영 복구를 위해 보존)
 */
export async function deleteAsset(id: string): Promise<void> {
  await portfolioCommands.deleteAsset(getHouseholdId(), id);
}

/**
 * 자산 목록 실시간 구독
 */
export function subscribeToAssets(
  callback: (assets: Asset[]) => void
): () => void {
  const householdId = getHouseholdId();

  const q = query(
    collection(db, ASSETS_COLLECTION),
    where('householdId', '==', householdId)
  );

  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      const assets = snapshot.docs.map(mapDocToAsset);
      // order 순으로 정렬, 같으면 이름순
      assets.sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        return a.name.localeCompare(b.name);
      });
      callback(assets);
    },
    (error) => {
      console.error('자산 구독 오류:', error);
      callback([]);
    }
  );

  return unsubscribe;
}

/**
 * 특정 기간의 모든 자산 이력 조회 (차트용)
 */
export async function getAssetHistoryByPeriod(
  startDate: string,
  endDate: string
): Promise<AssetHistoryEntry[]> {
  const householdId = getHouseholdId();

  const q = query(
    collection(db, HISTORY_COLLECTION),
    where('householdId', '==', householdId)
  );

  const snapshot = await getDocs(q);
  const allHistory = snapshot.docs.map(mapDocToHistory);

  // 클라이언트에서 날짜 필터링
  return allHistory
    .filter((h) => h.date >= startDate && h.date <= endDate)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 전월 말 총자산 조회 (asset_history에서 전월 마지막 TOTAL 스냅샷)
 */
export async function getPreviousMonthTotal(): Promise<number | null> {
  const householdId = getHouseholdId();
  const now = new Date();

  // 전월 마지막 날 계산
  const lastDayOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
  const endDate = formatLocalDate(lastDayOfPrevMonth);

  // 전월 첫째 날
  const firstDayOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const startDate = formatLocalDate(firstDayOfPrevMonth);

  try {
    // 전월의 TOTAL 스냅샷 중 가장 마지막 날짜 조회
    const q = query(
      collection(db, HISTORY_COLLECTION),
      where('householdId', '==', householdId),
      where('assetId', '==', 'TOTAL'),
      where('date', '>=', startDate),
      where('date', '<=', endDate),
      orderBy('date', 'desc')
    );

    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      return snapshot.docs[0].data().balance || null;
    }
  } catch (error) {
    console.error('전월 총자산 조회 오류:', error);
  }
  return null;
}

/**
 * 이번 달 자산 변동액 계산 (전월 대비)
 */
export async function getMonthlyAssetChange(currentTotal: number): Promise<number> {
  const previousTotal = await getPreviousMonthTotal();

  // 전월 스냅샷이 없으면 0 반환
  if (previousTotal === null) {
    return 0;
  }

  return currentTotal - previousTotal;
}

async function getLatestSnapshotBeforeToday(assetId: string): Promise<number | null> {
  const householdId = getHouseholdId();
  const today = formatLocalDate(new Date());

  try {
    const q = query(
      collection(db, HISTORY_COLLECTION),
      where('householdId', '==', householdId),
      where('assetId', '==', assetId),
      where('date', '<', today),
      orderBy('date', 'desc')
    );

    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      return null;
    }

    return snapshot.docs[0].data().balance || 0;
  } catch (error) {
    console.error('이전 일일 스냅샷 조회 오류:', error);
    return null;
  }
}

export async function getRealtimeDailyAssetChange(currentTotal: number): Promise<number> {
  const previousTotal = await getLatestSnapshotBeforeToday('TOTAL');
  if (previousTotal === null) {
    return 0;
  }

  return currentTotal - previousTotal;
}

/**
 * 오늘 자산 변동액 계산 (저장된 changeAmount 사용)
 */
export async function getDailyAssetChange(): Promise<number> {
  const householdId = getHouseholdId();
  const today = formatLocalDate(new Date());
  const todayId = `${householdId}_total_${today}`;

  try {
    const todaySnap = await getDoc(doc(db, HISTORY_COLLECTION, todayId));

    if (!todaySnap.exists()) {
      return 0;
    }

    // 스냅샷 저장 시 계산된 changeAmount 사용
    return todaySnap.data().changeAmount || 0;
  } catch (error) {
    console.error('일간 변동액 조회 오류:', error);
    return 0;
  }
}

function getOwnerSnapshotAssetId(owner: string): string {
  return `OWNER_${owner}`;
}

function getOwnerSnapshotIdSuffix(owner: string): string {
  return `owner_${encodeURIComponent(owner)}`;
}

export async function getRealtimeDailyAssetChangeByOwner(
  owner: string,
  assets: Array<Pick<Asset, 'type' | 'currentBalance' | 'owner'>>
): Promise<number> {
  if (!owner || owner === ALL_MEMBERS_OPTION) {
    return getRealtimeDailyAssetChange(
      assets.reduce((sum, asset) => sum + getAssetSignedBalance(asset), 0)
    );
  }

  const currentOwnerTotal = assets.reduce((sum, asset) => {
    if (asset.owner !== owner) {
      return sum;
    }

    return sum + getAssetSignedBalance(asset);
  }, 0);

  const previousOwnerTotal = await getLatestSnapshotBeforeToday(getOwnerSnapshotAssetId(owner));
  if (previousOwnerTotal === null) {
    return 0;
  }

  return currentOwnerTotal - previousOwnerTotal;
}

export async function getDailyAssetChangeByOwner(owner: string): Promise<number> {
  if (!owner || owner === ALL_MEMBERS_OPTION) {
    return getDailyAssetChange();
  }

  const householdId = getHouseholdId();
  const today = formatLocalDate(new Date());
  const todayId = `${householdId}_${getOwnerSnapshotIdSuffix(owner)}_${today}`;

  try {
    const todaySnap = await getDoc(doc(db, HISTORY_COLLECTION, todayId));

    if (!todaySnap.exists()) {
      return 0;
    }

    return todaySnap.data().changeAmount || 0;
  } catch (error) {
    console.error('사용자별 자산 변동액 조회 오류:', error);
    return 0;
  }
}

/**
 * 샘플 데이터 추가 (개발용)
 */
export async function addSampleAssets(): Promise<void> {
  const sampleAssets: AssetInput[] = [
    {
      name: '새마을금고 적금',
      type: 'savings',
      currentBalance: 12000000,
      currency: 'KRW',
      memo: '월 50만원 납입',
      isActive: true,
      order: 1,
    },
    {
      name: '새마을금고 출자금',
      type: 'savings',
      currentBalance: 5000000,
      currency: 'KRW',
      memo: '배당 연 4%',
      isActive: true,
      order: 2,
    },
    {
      name: '카카오뱅크 예금',
      type: 'savings',
      currentBalance: 3250000,
      currency: 'KRW',
      memo: '생활비',
      isActive: true,
      order: 3,
    },
    {
      name: '연금저축계좌',
      type: 'stock',
      currentBalance: 15800000,
      currency: 'KRW',
      memo: '미래에셋',
      isActive: true,
      order: 4,
    },
    {
      name: 'ISA',
      type: 'stock',
      currentBalance: 8500000,
      currency: 'KRW',
      memo: '한국투자증권',
      isActive: true,
      order: 5,
    },
    {
      name: '토스증권',
      type: 'stock',
      currentBalance: 5200000,
      currency: 'KRW',
      memo: '해외주식',
      isActive: true,
      order: 6,
    },
    {
      name: '전세보증금',
      type: 'property',
      currentBalance: 300000000,
      currency: 'KRW',
      memo: '2024.03 만기',
      isActive: true,
      order: 7,
    },
    {
      name: 'KRX 금현물',
      type: 'gold',
      currentBalance: 2500000,
      currency: 'KRW',
      memo: '5g 보유',
      isActive: true,
      order: 8,
    },
  ];

  for (const asset of sampleAssets) {
    await addAsset(asset);
  }
}

// ============================================
// 주식 보유 종목 관련 함수
// ============================================

/**
 * Firestore 문서를 StockHolding 객체로 변환
 */
function mapDocToHolding(docSnap: QueryDocumentSnapshot<DocumentData>): StockHolding {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    assetId: data.assetId,
    householdId: data.householdId,
    holdingType: data.holdingType || 'stock',
    stockCode: data.stockCode || '',
    stockName: data.stockName,
    market:
      data.market === 'KRX' ||
      data.market === 'US' ||
      data.market === 'KOFIA_FUND'
        ? data.market
        : 'UNRESOLVED',
    quantity: data.quantity || 1,
    avgPrice: data.avgPrice,
    currentPrice: data.currentPrice,
    instrumentType: data.instrumentType,
    priceScale: data.priceScale,
    quoteAsOf: data.quoteAsOf,
    createdAt: timestampToDate(data.createdAt) ?? new Date(0),
    updatedAt: timestampToDate(data.updatedAt) ?? new Date(0),
  };
}

function mapDocToCryptoHolding(docSnap: QueryDocumentSnapshot<DocumentData>): CryptoHolding {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    assetId: data.assetId,
    householdId: data.householdId,
    marketCode: data.marketCode,
    coinName: data.coinName,
    quantity: data.quantity,
    avgPrice: data.avgPrice,
    currentPrice: data.currentPrice,
    createdAt: timestampToDate(data.createdAt) ?? new Date(0),
    updatedAt: timestampToDate(data.updatedAt) ?? new Date(0),
  };
}

/**
 * 주식 보유 종목 추가
 */
export async function addStockHolding(input: StockHoldingInput): Promise<string> {
  return portfolioCommands.addPosition(getHouseholdId(), 'stock', input);
}

export async function addCryptoHolding(input: CryptoHoldingInput): Promise<string> {
  return portfolioCommands.addPosition(getHouseholdId(), 'crypto', input);
}

/**
 * 주식 보유 종목 수정
 */
export async function updateStockHolding(id: string, assetId: string, data: Partial<StockHolding>): Promise<void> {
  await portfolioCommands.updatePosition(getHouseholdId(), 'stock', id, assetId, data);
}

export async function updateCryptoHolding(
  id: string,
  assetId: string,
  data: Partial<CryptoHolding>
): Promise<void> {
  await portfolioCommands.updatePosition(getHouseholdId(), 'crypto', id, assetId, data);
}

/**
 * 주식 보유 종목 삭제
 */
export async function deleteStockHolding(id: string, assetId: string): Promise<void> {
  await portfolioCommands.deletePosition(getHouseholdId(), 'stock', id, assetId);
}

export async function deleteCryptoHolding(id: string, assetId: string): Promise<void> {
  await portfolioCommands.deletePosition(getHouseholdId(), 'crypto', id, assetId);
}

/**
 * 특정 자산(계좌)의 보유 종목 실시간 구독
 */
export function subscribeToStockHoldings(
  assetId: string,
  callback: (holdings: StockHolding[]) => void
): () => void {
  const householdId = getHouseholdId();

  const q = query(
    collection(db, HOLDINGS_COLLECTION),
    where('householdId', '==', householdId),
    where('assetId', '==', assetId)
  );

  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      const holdings = snapshot.docs.map(mapDocToHolding);
      holdings.sort((a, b) => a.stockName.localeCompare(b.stockName));
      callback(holdings);
    },
    (error) => {
      console.error('보유 종목 구독 오류:', error);
      callback([]);
    }
  );

  return unsubscribe;
}

export function subscribeToCryptoHoldings(
  assetId: string,
  callback: (holdings: CryptoHolding[]) => void
): () => void {
  const householdId = getHouseholdId();

  const q = query(
    collection(db, CRYPTO_HOLDINGS_COLLECTION),
    where('householdId', '==', householdId),
    where('assetId', '==', assetId)
  );

  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      const holdings = snapshot.docs.map(mapDocToCryptoHolding);
      holdings.sort((a, b) => a.coinName.localeCompare(b.coinName));
      callback(holdings);
    },
    (error) => {
      console.error('코인 보유내역 구독 오류:', error);
      callback([]);
    }
  );

  return unsubscribe;
}

// ============================================
// 배당금 스냅샷 관련 함수
// ============================================

const DIVIDEND_COLLECTION = 'dividend_snapshots';
const DIVIDEND_EVENTS_COLLECTION = 'dividend_events';

export interface DividendSnapshotEventRecord {
  stockCode: string;
  stockName: string;
  paymentDate: string;
  perShareAmount: number;
  quantity: number;
  totalAmount: number;
}

export interface DividendSnapshotData {
  monthlyData: number[];
  events: Record<string, DividendSnapshotEventRecord>;
}

export interface DividendEventRecord {
  id: string;
  householdId: string;
  stockCode: string;
  stockName: string;
  recordDate: string;
  paymentDate: string;
  paymentYear: number | null;
  perShareAmount: number;
  eligibleQuantity: number | null;
  totalAmount: number | null;
  status: string;
}

function createEmptyDividendMonthlyData() {
  return Array.from({ length: 12 }, () => 0);
}

function normalizeDividendSnapshotData(data?: DocumentData | null): DividendSnapshotData {
  const monthlyData = Array.isArray(data?.monthlyData)
    ? [...data.monthlyData, ...createEmptyDividendMonthlyData()].slice(0, 12).map((value) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
      })
    : createEmptyDividendMonthlyData();

  const events = data?.events && typeof data.events === 'object' ? data.events : {};

  return {
    monthlyData,
    events,
  };
}

function mapDocToDividendEvent(docSnap: QueryDocumentSnapshot<DocumentData>): DividendEventRecord {
  const data = docSnap.data();
  const paymentDate = String(data.paymentDate || '');

  return {
    id: docSnap.id,
    householdId: data.householdId,
    stockCode: String(data.stockCode || '').trim().toUpperCase(),
    stockName: data.stockName || data.stockCode || '',
    recordDate: String(data.recordDate || ''),
    paymentDate,
    paymentYear:
      typeof data.paymentYear === 'number'
        ? data.paymentYear
        : Number(paymentDate.slice(0, 4)) || null,
    perShareAmount: Number(data.perShareAmount || 0),
    eligibleQuantity: typeof data.eligibleQuantity === 'number' ? data.eligibleQuantity : null,
    totalAmount: typeof data.totalAmount === 'number' ? data.totalAmount : null,
    status: String(data.status || ''),
  };
}

function buildDividendMonthlyDataFromEvents(
  events: Record<string, DividendSnapshotEventRecord>
): number[] {
  const monthlyData = createEmptyDividendMonthlyData();

  Object.values(events).forEach((event) => {
    const [year, month] = event.paymentDate.split('-').map(Number);
    if (!year || !month || month < 1 || month > 12) {
      return;
    }

    monthlyData[month - 1] += event.totalAmount;
  });

  return monthlyData.map((amount) => Math.round(amount));
}


/**
 * 연도별 배당금 스냅샷 조회
 */
export async function getDividendSnapshot(year: number): Promise<DividendSnapshotData | null> {
  const householdId = getHouseholdId();
  const docId = `${householdId}_${year}`;

  try {
    const docSnap = await getDoc(doc(db, DIVIDEND_COLLECTION, docId));
    if (docSnap.exists()) {
      return normalizeDividendSnapshotData(docSnap.data());
    }
  } catch (error) {
    console.error('배당금 스냅샷 조회 오류:', error);
  }
  return null;
}

export async function getDividendEventsByYear(year: number): Promise<DividendEventRecord[]> {
  const householdId = getHouseholdId();

  try {
    const q = query(
      collection(db, DIVIDEND_EVENTS_COLLECTION),
      where('householdId', '==', householdId)
    );
    const snapshot = await getDocs(q);

    return snapshot.docs
      .map(mapDocToDividendEvent)
      .filter((event) => event.paymentYear === year)
      .sort((left, right) => {
        if (left.paymentDate !== right.paymentDate) {
          return right.paymentDate.localeCompare(left.paymentDate);
        }

        return left.stockName.localeCompare(right.stockName, 'ko');
      });
  } catch (error) {
    console.error('배당금 이벤트 조회 오류:', error);
    return [];
  }
}

/**
 * 모든 주식 보유 종목 조회 (배당금 계산용)
 */
export async function getAllStockHoldings(): Promise<StockHolding[]> {
  const householdId = getHouseholdId();

  const q = query(
    collection(db, HOLDINGS_COLLECTION),
    where('householdId', '==', householdId)
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map(mapDocToHolding);
}

export async function refreshAllMarketValues(): Promise<void> {
  await portfolioCommands.refreshMarketValues(getHouseholdId(), 'all');
}

export async function refreshAssetMarketValues(
  assetId: string,
  assetClass: 'stock' | 'crypto' | 'physical-gold'
): Promise<void> {
  await portfolioCommands.refreshMarketValues(getHouseholdId(), assetClass, assetId);
}

export async function refreshAllPhysicalGoldValues(): Promise<void> {
  await portfolioCommands.refreshMarketValues(getHouseholdId(), 'physical-gold');
}
