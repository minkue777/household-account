import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  query,
  where,
  onSnapshot,
  Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { BudgetTransfer } from '@/types/budget';

export type { BudgetTransfer };

const COLLECTION_NAME = 'budgetTransfers';

/**
 * 예산 이동 추가
 */
export async function addBudgetTransfer(
  householdId: string,
  yearMonth: string,
  fromCategory: string,
  toCategory: string,
  amount: number,
  memo?: string
): Promise<string> {
  const docRef = await addDoc(collection(db, COLLECTION_NAME), {
    householdId,
    yearMonth,
    fromCategory,
    toCategory,
    amount,
    memo: memo || '',
    createdAt: Timestamp.now(),
  });
  return docRef.id;
}

/**
 * 예산 이동 삭제
 */
export async function deleteBudgetTransfer(id: string): Promise<void> {
  const docRef = doc(db, COLLECTION_NAME, id);
  await deleteDoc(docRef);
}

/**
 * 특정 월의 예산 이동 목록 실시간 구독 (householdId별로)
 */
export function subscribeToMonthlyBudgetTransfers(
  householdId: string,
  yearMonth: string,
  callback: (transfers: BudgetTransfer[]) => void
): () => void {
  if (!householdId) {
    callback([]);
    return () => {};
  }

  const q = query(
    collection(db, COLLECTION_NAME),
    where('householdId', '==', householdId),
    where('yearMonth', '==', yearMonth)
  );

  const unsubscribe = onSnapshot(q, (snapshot) => {
    const transfers = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        householdId: data.householdId,
        yearMonth: data.yearMonth,
        fromCategory: data.fromCategory,
        toCategory: data.toCategory,
        amount: data.amount,
        memo: data.memo,
        createdAt: data.createdAt?.toDate() || new Date(),
      } as BudgetTransfer;
    });
    callback(transfers);
  }, (error) => {
    callback([]);
  });

  return unsubscribe;
}

/**
 * 월별 카테고리 예산 조정값 계산
 * 반환: { [categoryKey]: adjustmentAmount }
 * - 양수: 예산 증가
 * - 음수: 예산 감소
 */
export function calculateBudgetAdjustments(
  transfers: BudgetTransfer[]
): Record<string, number> {
  const adjustments: Record<string, number> = {};

  transfers.forEach((transfer) => {
    // fromCategory는 예산 감소
    adjustments[transfer.fromCategory] = (adjustments[transfer.fromCategory] || 0) - transfer.amount;
    // toCategory는 예산 증가
    adjustments[transfer.toCategory] = (adjustments[transfer.toCategory] || 0) + transfer.amount;
  });

  return adjustments;
}
