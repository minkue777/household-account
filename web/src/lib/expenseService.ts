import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  orderBy,
  onSnapshot,
  Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { Expense } from '@/types/expense';

const COLLECTION_NAME = 'expenses';

/**
 * 지출 추가
 */
export async function addExpense(expense: Omit<Expense, 'id'>): Promise<string> {
  const docRef = await addDoc(collection(db, COLLECTION_NAME), {
    ...expense,
    createdAt: Timestamp.now(),
  });
  return docRef.id;
}

/**
 * 지출 수정
 */
export async function updateExpense(id: string, data: Partial<Expense>): Promise<void> {
  const docRef = doc(db, COLLECTION_NAME, id);
  await updateDoc(docRef, data);
}

/**
 * 지출 삭제
 */
export async function deleteExpense(id: string): Promise<void> {
  const docRef = doc(db, COLLECTION_NAME, id);
  await deleteDoc(docRef);
}

/**
 * 특정 월의 지출 목록 실시간 구독
 */
export function subscribeToMonthlyExpenses(
  year: number,
  month: number,
  callback: (expenses: Expense[]) => void
): () => void {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = `${year}-${String(month).padStart(2, '0')}-31`;

  // 단순 쿼리 (인덱스 불필요) - 클라이언트에서 필터링
  const q = query(
    collection(db, COLLECTION_NAME),
    orderBy('date', 'desc')
  );

  const unsubscribe = onSnapshot(q, (snapshot) => {
    const allExpenses = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        date: data.date,
        time: data.time,
        merchant: data.merchant,
        amount: data.amount,
        // Android는 대문자로 저장하므로 소문자로 변환
        category: (data.category || 'etc').toLowerCase(),
        cardType: (data.cardType || 'main').toLowerCase(),
        cardLastFour: data.cardLastFour,
        memo: data.memo,
      } as Expense;
    });

    // 클라이언트에서 날짜 필터링
    const filtered = allExpenses.filter(
      (e) => e.date >= startDate && e.date <= endDate
    );

    callback(filtered);
  }, (error) => {
    console.error('Firestore subscription error:', error);
    callback([]);
  });

  return unsubscribe;
}

/**
 * 카테고리 업데이트
 */
export async function updateCategory(id: string, category: string): Promise<void> {
  const docRef = doc(db, COLLECTION_NAME, id);
  await updateDoc(docRef, { category });
}

/**
 * 수동 지출 추가
 */
export async function addManualExpense(
  merchant: string,
  amount: number,
  category: string,
  date: string
): Promise<string> {
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const docRef = await addDoc(collection(db, COLLECTION_NAME), {
    date,
    time,
    merchant,
    amount,
    category,
    cardType: 'main',
    cardLastFour: '수동',
    memo: '',
    createdAt: Timestamp.now(),
  });
  return docRef.id;
}
