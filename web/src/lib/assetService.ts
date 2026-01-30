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
  runTransaction,
  QueryDocumentSnapshot,
  DocumentData,
  orderBy,
} from 'firebase/firestore';
import { db } from './firebase';
import { Asset, AssetHistoryEntry, AssetInput } from '@/types/asset';
import { getStoredHouseholdKey } from './householdService';

const ASSETS_COLLECTION = 'assets';
const HISTORY_COLLECTION = 'asset_history';

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
    currentBalance: data.currentBalance || 0,
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

  const docRef = await addDoc(collection(db, ASSETS_COLLECTION), {
    ...input,
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
  await updateDoc(docRef, {
    ...data,
    updatedAt: Timestamp.now(),
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
 * 이번 달 자산 변동액 계산
 */
export async function getMonthlyAssetChange(): Promise<number> {
  const householdId = getHouseholdId();
  const now = new Date();
  const startOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const endOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-31`;

  const q = query(
    collection(db, HISTORY_COLLECTION),
    where('householdId', '==', householdId)
  );

  const snapshot = await getDocs(q);
  const allHistory = snapshot.docs.map(mapDocToHistory);

  // 이번 달 변동액 합계
  return allHistory
    .filter((h) => h.date >= startOfMonth && h.date <= endOfMonth)
    .reduce((sum, h) => sum + h.changeAmount, 0);
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
