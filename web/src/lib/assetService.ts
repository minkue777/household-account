import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  onSnapshot,
  Timestamp,
  getDocs,
  getDoc,
  setDoc,
  runTransaction,
  QueryDocumentSnapshot,
  DocumentData,
  orderBy,
} from 'firebase/firestore';
import { db } from './firebase';
import { Asset, AssetHistoryEntry, AssetInput, StockHolding, StockHoldingInput } from '@/types/asset';
import { getStoredHouseholdKey } from './householdService';

const ASSETS_COLLECTION = 'assets';
const HISTORY_COLLECTION = 'asset_history';
const HOLDINGS_COLLECTION = 'stock_holdings';

/**
 * 현재 가구 키 가져오기
 */
function getHouseholdId(): string {
  const key = getStoredHouseholdKey();
  if (!key) {
    throw new Error('가구 키가 없습니다. 다시 로그인해주세요.');
  }
  return key;
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
    currentBalance: data.currentBalance || 0,
    costBasis: data.costBasis,
    initialInvestment: data.initialInvestment,
    currency: data.currency || 'KRW',
    memo: data.memo,
    icon: data.icon,
    color: data.color,
    isActive: data.isActive !== false,
    order: data.order || 0,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
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
    previousBalance: data.previousBalance,
    changeAmount: data.changeAmount,
    memo: data.memo,
    createdAt: data.createdAt,
  };
}

/**
 * 자산 추가
 */
export async function addAsset(input: AssetInput): Promise<string> {
  const householdId = getHouseholdId();
  const now = Timestamp.now();

  // undefined 값 제거 (Firestore는 undefined를 허용하지 않음)
  const cleanInput = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  );

  const docRef = await addDoc(collection(db, ASSETS_COLLECTION), {
    ...cleanInput,
    householdId,
    createdAt: now,
    updatedAt: now,
  });

  // 초기 잔액이 있으면 이력 추가
  if (input.currentBalance > 0) {
    await addDoc(collection(db, HISTORY_COLLECTION), {
      householdId,
      assetId: docRef.id,
      balance: input.currentBalance,
      date: new Date().toISOString().split('T')[0],
      previousBalance: 0,
      changeAmount: input.currentBalance,
      memo: '초기 잔액',
      createdAt: now,
    });
  }

  return docRef.id;
}

/**
 * 자산 수정
 */
export async function updateAsset(id: string, data: Partial<Asset>): Promise<void> {
  const docRef = doc(db, ASSETS_COLLECTION, id);

  // undefined 값만 제거 (빈 문자열은 허용)
  const cleanData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      cleanData[key] = value;
    }
  }

  await updateDoc(docRef, {
    ...cleanData,
    updatedAt: Timestamp.now(),
  });
}

/**
 * 자산 순서 일괄 업데이트
 */
export async function updateAssetOrders(assetOrders: { id: string; order: number }[]): Promise<void> {
  await runTransaction(db, async (transaction) => {
    assetOrders.forEach(({ id, order }) => {
      const docRef = doc(db, ASSETS_COLLECTION, id);
      transaction.update(docRef, { order, updatedAt: Timestamp.now() });
    });
  });
}

/**
 * 자산 삭제 (및 관련 이력 삭제)
 */
export async function deleteAsset(id: string): Promise<void> {
  const householdId = getHouseholdId();

  // 관련 이력 삭제
  const historyQuery = query(
    collection(db, HISTORY_COLLECTION),
    where('householdId', '==', householdId),
    where('assetId', '==', id)
  );
  const historySnapshot = await getDocs(historyQuery);

  await runTransaction(db, async (transaction) => {
    // 이력 삭제
    historySnapshot.docs.forEach((docSnap) => {
      transaction.delete(doc(db, HISTORY_COLLECTION, docSnap.id));
    });
    // 자산 삭제
    transaction.delete(doc(db, ASSETS_COLLECTION, id));
  });
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
 * 특정 자산의 이력 조회
 */
export async function getAssetHistory(assetId: string): Promise<AssetHistoryEntry[]> {
  const householdId = getHouseholdId();

  const q = query(
    collection(db, HISTORY_COLLECTION),
    where('householdId', '==', householdId),
    where('assetId', '==', assetId)
  );

  const snapshot = await getDocs(q);
  const history = snapshot.docs.map(mapDocToHistory);

  // 날짜 내림차순 정렬
  return history.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * 특정 자산의 이력 실시간 구독
 */
export function subscribeToAssetHistory(
  assetId: string,
  callback: (history: AssetHistoryEntry[]) => void
): () => void {
  const householdId = getHouseholdId();

  const q = query(
    collection(db, HISTORY_COLLECTION),
    where('householdId', '==', householdId),
    where('assetId', '==', assetId)
  );

  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      const history = snapshot.docs.map(mapDocToHistory);
      // 날짜 내림차순 정렬
      history.sort((a, b) => b.date.localeCompare(a.date));
      callback(history);
    },
    (error) => {
      console.error('자산 이력 구독 오류:', error);
      callback([]);
    }
  );

  return unsubscribe;
}

/**
 * 잔액 업데이트 (트랜잭션으로 자산 + 이력 동시 업데이트)
 */
export async function updateBalanceWithHistory(
  assetId: string,
  newBalance: number,
  date: string,
  memo?: string
): Promise<void> {
  const householdId = getHouseholdId();
  const now = Timestamp.now();

  await runTransaction(db, async (transaction) => {
    // 1. 현재 자산 조회
    const assetRef = doc(db, ASSETS_COLLECTION, assetId);
    const assetSnap = await transaction.get(assetRef);

    if (!assetSnap.exists()) {
      throw new Error('자산을 찾을 수 없습니다.');
    }

    const currentBalance = assetSnap.data().currentBalance || 0;
    const changeAmount = newBalance - currentBalance;

    // 2. 이력 추가
    const historyRef = doc(collection(db, HISTORY_COLLECTION));
    transaction.set(historyRef, {
      householdId,
      assetId,
      balance: newBalance,
      date,
      previousBalance: currentBalance,
      changeAmount,
      memo: memo || '',
      createdAt: now,
    });

    // 3. 자산 잔액 업데이트
    transaction.update(assetRef, {
      currentBalance: newBalance,
      updatedAt: now,
    });
  });
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
 * 전월 말 총자산 스냅샷 조회
 */
export async function getPreviousMonthTotal(): Promise<number | null> {
  const householdId = getHouseholdId();
  const now = new Date();

  // 전월 계산
  const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const snapshotId = `${householdId}_${prevYear}-${String(prevMonth).padStart(2, '0')}`;

  try {
    const docSnap = await getDoc(doc(db, 'asset_snapshots', snapshotId));
    if (docSnap.exists()) {
      return docSnap.data().totalBalance || null;
    }
  } catch (error) {
    console.error('스냅샷 조회 오류:', error);
  }
  return null;
}

/**
 * 이번 달 총자산 스냅샷 저장
 */
export async function saveMonthlySnapshot(totalBalance: number): Promise<void> {
  const householdId = getHouseholdId();
  const now = new Date();
  const snapshotId = `${householdId}_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  try {
    await setDoc(doc(db, 'asset_snapshots', snapshotId), {
      householdId,
      totalBalance,
      month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
      updatedAt: Timestamp.now(),
    });
  } catch (error) {
    console.error('스냅샷 저장 오류:', error);
  }
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

/**
 * 이력 항목 삭제
 */
export async function deleteHistoryEntry(historyId: string): Promise<void> {
  await deleteDoc(doc(db, HISTORY_COLLECTION, historyId));
}

/**
 * 자산 순서 업데이트
 */
export async function updateAssetOrder(assets: { id: string; order: number }[]): Promise<void> {
  const batch = assets.map(({ id, order }) =>
    updateDoc(doc(db, ASSETS_COLLECTION, id), { order, updatedAt: Timestamp.now() })
  );
  await Promise.all(batch);
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
    stockCode: data.stockCode,
    stockName: data.stockName,
    quantity: data.quantity,
    avgPrice: data.avgPrice,
    currentPrice: data.currentPrice,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

/**
 * 주식 계좌의 총 평가금액 및 투자원금 계산 및 업데이트
 */
async function updateAssetBalanceFromHoldings(assetId: string): Promise<void> {
  const householdId = getHouseholdId();

  const q = query(
    collection(db, HOLDINGS_COLLECTION),
    where('householdId', '==', householdId),
    where('assetId', '==', assetId)
  );

  const snapshot = await getDocs(q);

  let totalValue = 0;
  let totalCostBasis = 0;

  snapshot.docs.forEach((docSnap) => {
    const data = docSnap.data();
    const quantity = data.quantity || 0;
    const avgPrice = data.avgPrice || 0;
    const currentPrice = data.currentPrice || avgPrice;

    totalValue += currentPrice * quantity;
    totalCostBasis += avgPrice * quantity;
  });

  await updateDoc(doc(db, ASSETS_COLLECTION, assetId), {
    currentBalance: totalValue,
    costBasis: totalCostBasis,
    updatedAt: Timestamp.now(),
  });
}

/**
 * 주식 보유 종목 추가
 */
export async function addStockHolding(input: StockHoldingInput): Promise<string> {
  const householdId = getHouseholdId();
  const now = Timestamp.now();

  const cleanInput = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  );

  const docRef = await addDoc(collection(db, HOLDINGS_COLLECTION), {
    ...cleanInput,
    householdId,
    createdAt: now,
    updatedAt: now,
  });

  // 자산 총액 업데이트
  await updateAssetBalanceFromHoldings(input.assetId);

  return docRef.id;
}

/**
 * 주식 보유 종목 수정
 */
export async function updateStockHolding(id: string, assetId: string, data: Partial<StockHolding>): Promise<void> {
  const docRef = doc(db, HOLDINGS_COLLECTION, id);

  const cleanData = Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined)
  );

  await updateDoc(docRef, {
    ...cleanData,
    updatedAt: Timestamp.now(),
  });

  // 자산 총액 업데이트
  await updateAssetBalanceFromHoldings(assetId);
}

/**
 * 주식 보유 종목 삭제
 */
export async function deleteStockHolding(id: string, assetId: string): Promise<void> {
  await deleteDoc(doc(db, HOLDINGS_COLLECTION, id));

  // 자산 총액 업데이트
  await updateAssetBalanceFromHoldings(assetId);
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

/**
 * 자산 삭제 시 연결된 보유 종목도 함께 삭제
 */
export async function deleteAssetWithHoldings(assetId: string): Promise<void> {
  const householdId = getHouseholdId();

  // 관련 이력 조회
  const historyQuery = query(
    collection(db, HISTORY_COLLECTION),
    where('householdId', '==', householdId),
    where('assetId', '==', assetId)
  );
  const historySnapshot = await getDocs(historyQuery);

  // 관련 보유 종목 조회
  const holdingsQuery = query(
    collection(db, HOLDINGS_COLLECTION),
    where('householdId', '==', householdId),
    where('assetId', '==', assetId)
  );
  const holdingsSnapshot = await getDocs(holdingsQuery);

  await runTransaction(db, async (transaction) => {
    // 이력 삭제
    historySnapshot.docs.forEach((docSnap) => {
      transaction.delete(doc(db, HISTORY_COLLECTION, docSnap.id));
    });
    // 보유 종목 삭제
    holdingsSnapshot.docs.forEach((docSnap) => {
      transaction.delete(doc(db, HOLDINGS_COLLECTION, docSnap.id));
    });
    // 자산 삭제
    transaction.delete(doc(db, ASSETS_COLLECTION, assetId));
  });
}
