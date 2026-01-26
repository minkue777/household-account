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
} from 'firebase/firestore';
import { db } from './firebase';
import { Expense, MergedExpenseInfo } from '@/types/expense';
import { getStoredHouseholdKey } from './householdService';

const COLLECTION_NAME = 'expenses';

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
 * Firestore 문서를 Expense 객체로 변환 (DRY 원칙)
 */
function mapDocToExpense(docSnap: QueryDocumentSnapshot<DocumentData>): Expense {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    date: data.date,
    time: data.time,
    merchant: data.merchant,
    amount: data.amount,
    // Android는 대문자로 저장하므로 소문자로 변환
    category: (data.category || 'etc').toLowerCase(),
    cardType: (data.cardType || 'main').toLowerCase(),
    cardLastFour: data.cardLastFour,
    memo: data.memo,
    mergedFrom: data.mergedFrom,
    splitGroupId: data.splitGroupId,
    splitIndex: data.splitIndex,
    splitTotal: data.splitTotal,
  };
}

/**
 * 지출 추가
 */
export async function addExpense(expense: Omit<Expense, 'id'>): Promise<string> {
  const householdId = getHouseholdId();
  const docRef = await addDoc(collection(db, COLLECTION_NAME), {
    ...expense,
    householdId,
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
  const householdId = getHouseholdId();
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = `${year}-${String(month).padStart(2, '0')}-31`;

  // householdId로 필터링 (인덱스 없이 클라이언트에서 정렬)
  const q = query(
    collection(db, COLLECTION_NAME),
    where('householdId', '==', householdId)
  );

  const unsubscribe = onSnapshot(q, (snapshot) => {
    const allExpenses = snapshot.docs.map(mapDocToExpense);

    // 클라이언트에서 날짜 필터링 및 정렬
    const filtered = allExpenses
      .filter((e) => e.date >= startDate && e.date <= endDate)
      .sort((a, b) => b.date.localeCompare(a.date));

    callback(filtered);
  }, (error) => {
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
 * 기간별 지출 목록 실시간 구독
 */
export function subscribeToDateRangeExpenses(
  startDate: string,  // YYYY-MM-DD
  endDate: string,    // YYYY-MM-DD
  callback: (expenses: Expense[]) => void
): () => void {
  const householdId = getHouseholdId();

  const q = query(
    collection(db, COLLECTION_NAME),
    where('householdId', '==', householdId)
  );

  const unsubscribe = onSnapshot(q, (snapshot) => {
    const allExpenses = snapshot.docs.map(mapDocToExpense);

    const filtered = allExpenses
      .filter((e) => e.date >= startDate && e.date <= endDate)
      .sort((a, b) => b.date.localeCompare(a.date));

    callback(filtered);
  }, (error) => {
    callback([]);
  });

  return unsubscribe;
}

/**
 * 수동 지출 추가
 */
export async function addManualExpense(
  merchant: string,
  amount: number,
  category: string,
  date: string,
  memo?: string
): Promise<string> {
  const householdId = getHouseholdId();
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
    memo: memo || '',
    householdId,
    createdAt: Timestamp.now(),
  });
  return docRef.id;
}

/**
 * 잘못된 카테고리 일괄 수정
 */
export async function fixInvalidCategories(
  validCategories: string[]
): Promise<number> {
  const householdId = getHouseholdId();
  const categoryMap: Record<string, string> = {
    'baby': 'childcare',
    'transport': 'living',
    'medical': 'living',
  };

  const q = query(
    collection(db, COLLECTION_NAME),
    where('householdId', '==', householdId)
  );
  const snapshot = await getDocs(q);

  let fixedCount = 0;

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    const category = (data.category || '').toLowerCase();

    // 유효한 카테고리가 아닌 경우
    if (!validCategories.includes(category)) {
      const newCategory = categoryMap[category] || 'etc';
      await updateDoc(doc(db, COLLECTION_NAME, docSnap.id), { category: newCategory });
      fixedCount++;
    }
  }

  return fixedCount;
}

/**
 * 지출 분할
 * 원본 지출을 삭제하고 여러 개의 새 지출로 분할
 */
export interface SplitItem {
  merchant: string;
  amount: number;
  category: string;
  memo?: string;
}

export async function splitExpense(
  originalExpense: Expense,
  splits: SplitItem[]
): Promise<string[]> {
  const householdId = getHouseholdId();

  return runTransaction(db, async (transaction) => {
    // 원본 지출 삭제
    const originalRef = doc(db, COLLECTION_NAME, originalExpense.id);
    transaction.delete(originalRef);

    // 분할된 지출들 추가
    const newIds: string[] = [];
    for (const split of splits) {
      const newDocRef = doc(collection(db, COLLECTION_NAME));
      transaction.set(newDocRef, {
        date: originalExpense.date,
        time: originalExpense.time,
        merchant: split.merchant,
        amount: split.amount,
        category: split.category,
        cardType: originalExpense.cardType,
        cardLastFour: originalExpense.cardLastFour,
        memo: split.memo || '',
        householdId,
        createdAt: Timestamp.now(),
      });
      newIds.push(newDocRef.id);
    }

    return newIds;
  });
}

/**
 * 지출 합치기
 * 소스 지출을 타겟 지출에 합침 (타겟의 가맹점명, 카테고리 유지)
 * 원본 정보를 저장하여 되돌리기 가능
 */
export async function mergeExpenses(
  targetExpense: Expense,
  sourceExpense: Expense
): Promise<void> {
  return runTransaction(db, async (transaction) => {
    // 타겟 지출의 금액을 합산
    const newAmount = targetExpense.amount + sourceExpense.amount;

    // 원본 정보 저장 (되돌리기용)
    const existingMerged = targetExpense.mergedFrom || [];
    const mergedFrom: MergedExpenseInfo[] = [
      ...existingMerged,
      // 타겟이 아직 합쳐진 적 없으면 타겟 정보도 저장
      ...(existingMerged.length === 0 ? [{
        merchant: targetExpense.merchant,
        amount: targetExpense.amount,
        category: targetExpense.category,
        memo: targetExpense.memo || '',
      }] : []),
      // 소스 정보 저장
      {
        merchant: sourceExpense.merchant,
        amount: sourceExpense.amount,
        category: sourceExpense.category,
        memo: sourceExpense.memo || '',
      },
    ];

    // 타겟 지출 업데이트
    const targetRef = doc(db, COLLECTION_NAME, targetExpense.id);
    transaction.update(targetRef, { amount: newAmount, mergedFrom });

    // 소스 지출 삭제
    const sourceRef = doc(db, COLLECTION_NAME, sourceExpense.id);
    transaction.delete(sourceRef);
  });
}

/**
 * 합쳐진 지출 되돌리기
 * 원본 지출들을 다시 생성하고 합쳐진 지출 삭제
 */
export async function unmergeExpense(expense: Expense): Promise<string[]> {
  if (!expense.mergedFrom || expense.mergedFrom.length === 0) {
    return [];
  }

  const householdId = getHouseholdId();

  return runTransaction(db, async (transaction) => {
    const newIds: string[] = [];

    // 원본 지출들 다시 생성
    for (const original of expense.mergedFrom!) {
      const newDocRef = doc(collection(db, COLLECTION_NAME));
      transaction.set(newDocRef, {
        date: expense.date,
        time: expense.time,
        merchant: original.merchant,
        amount: original.amount,
        category: original.category,
        cardType: expense.cardType,
        cardLastFour: expense.cardLastFour,
        memo: original.memo || '',
        householdId,
        createdAt: Timestamp.now(),
      });
      newIds.push(newDocRef.id);
    }

    // 합쳐진 지출 삭제
    const expenseRef = doc(db, COLLECTION_NAME, expense.id);
    transaction.delete(expenseRef);

    return newIds;
  });
}

/**
 * 키워드로 지출 검색
 * 가맹점명, 메모에서 키워드 검색
 */
export async function searchExpenses(keyword: string): Promise<Expense[]> {
  if (!keyword.trim()) {
    return [];
  }

  const householdId = getHouseholdId();

  const q = query(
    collection(db, COLLECTION_NAME),
    where('householdId', '==', householdId)
  );

  const snapshot = await getDocs(q);
  const lowerKeyword = keyword.toLowerCase();

  const results = snapshot.docs
    .map(mapDocToExpense)
    .filter((expense) => {
      const merchantMatch = expense.merchant.toLowerCase().includes(lowerKeyword);
      const memoMatch = expense.memo?.toLowerCase().includes(lowerKeyword);
      return merchantMatch || memoMatch;
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  return results;
}

/**
 * 월별 분할 그룹 ID 생성
 */
export function generateSplitGroupId(): string {
  return `split_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 월별 분할 그룹의 모든 지출 조회
 */
export async function getSplitGroupExpenses(splitGroupId: string): Promise<Expense[]> {
  const householdId = getHouseholdId();

  const q = query(
    collection(db, COLLECTION_NAME),
    where('householdId', '==', householdId),
    where('splitGroupId', '==', splitGroupId)
  );

  const snapshot = await getDocs(q);
  return snapshot.docs
    .map(mapDocToExpense)
    .sort((a, b) => (a.splitIndex || 0) - (b.splitIndex || 0));
}

/**
 * 월별 분할 취소 (합치기)
 * 분할된 지출들을 삭제하고 원래 금액의 단일 지출로 복원
 */
export async function cancelSplitGroup(splitGroupId: string): Promise<void> {
  const expenses = await getSplitGroupExpenses(splitGroupId);
  if (expenses.length === 0) return;

  const householdId = getHouseholdId();
  const firstExpense = expenses[0];
  const totalAmount = expenses.reduce((sum, e) => sum + e.amount, 0);
  // 가맹점명에서 분할 표시 제거 (예: "스타벅스 (1/3)" -> "스타벅스")
  const baseMerchant = firstExpense.merchant.replace(/\s*\(\d+\/\d+\)$/, '');

  await runTransaction(db, async (transaction) => {
    // 분할된 지출 모두 삭제
    for (const expense of expenses) {
      const docRef = doc(db, COLLECTION_NAME, expense.id);
      transaction.delete(docRef);
    }

    // 원래 금액의 단일 지출 생성
    const newDocRef = doc(collection(db, COLLECTION_NAME));
    transaction.set(newDocRef, {
      date: firstExpense.date,
      time: firstExpense.time || '09:00',
      merchant: baseMerchant,
      amount: totalAmount,
      category: firstExpense.category,
      cardType: firstExpense.cardType || 'main',
      householdId,
      createdAt: Timestamp.now(),
    });
  });
}

/**
 * 월별 분할 그룹 개월 수 수정
 * 기존 그룹 삭제 후 새로운 개월 수로 재생성
 */
export async function updateSplitGroup(
  splitGroupId: string,
  newMonths: number
): Promise<string> {
  const expenses = await getSplitGroupExpenses(splitGroupId);
  if (expenses.length === 0) {
    throw new Error('분할 그룹을 찾을 수 없습니다.');
  }

  // 원본 정보 계산
  const firstExpense = expenses[0];
  const totalAmount = expenses.reduce((sum, e) => sum + e.amount, 0);
  const monthlyAmount = Math.floor(totalAmount / newMonths);
  const baseDate = new Date(firstExpense.date);
  // 가맹점명에서 기존 분할 표시 제거 (예: "스타벅스 (1/3)" -> "스타벅스")
  const baseMerchant = firstExpense.merchant.replace(/\s*\(\d+\/\d+\)$/, '');

  // 새 그룹 ID 생성
  const newGroupId = generateSplitGroupId();
  const householdId = getHouseholdId();

  await runTransaction(db, async (transaction) => {
    // 기존 그룹 삭제
    for (const expense of expenses) {
      const docRef = doc(db, COLLECTION_NAME, expense.id);
      transaction.delete(docRef);
    }

    // 새로운 분할 지출 생성
    for (let i = 0; i < newMonths; i++) {
      const targetDate = new Date(baseDate);
      targetDate.setMonth(targetDate.getMonth() + i);
      const dateStr = targetDate.toISOString().split('T')[0];

      const newDocRef = doc(collection(db, COLLECTION_NAME));
      transaction.set(newDocRef, {
        date: dateStr,
        time: firstExpense.time || '09:00',
        merchant: `${baseMerchant} (${i + 1}/${newMonths})`,
        amount: monthlyAmount,
        category: firstExpense.category,
        cardType: firstExpense.cardType || 'main',
        splitGroupId: newGroupId,
        splitIndex: i + 1,
        splitTotal: newMonths,
        householdId,
        createdAt: Timestamp.now(),
      });
    }
  });

  return newGroupId;
}
