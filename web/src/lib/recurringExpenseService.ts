import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  getDocs,
  onSnapshot,
  Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { RecurringExpense, CreateRecurringExpenseInput } from '@/types/recurring';
import { addExpense } from './expenseService';

const COLLECTION_NAME = 'recurring_expenses';
const recurringRef = collection(db, COLLECTION_NAME);

/**
 * 정기 지출 추가
 */
export async function addRecurringExpense(
  householdId: string,
  input: CreateRecurringExpenseInput
): Promise<string> {
  if (!householdId) return '';

  const docRef = await addDoc(recurringRef, {
    householdId,
    merchant: input.merchant,
    amount: input.amount,
    category: input.category,
    dayOfMonth: input.dayOfMonth,
    memo: input.memo || '',
    isActive: true,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });

  return docRef.id;
}

/**
 * 정기 지출 수정
 */
export async function updateRecurringExpense(
  id: string,
  updates: Partial<CreateRecurringExpenseInput & { isActive: boolean }>
): Promise<void> {
  const docRef = doc(db, COLLECTION_NAME, id);
  await updateDoc(docRef, {
    ...updates,
    updatedAt: Timestamp.now(),
  });
}

/**
 * 정기 지출 삭제
 */
export async function deleteRecurringExpense(id: string): Promise<void> {
  const docRef = doc(db, COLLECTION_NAME, id);
  await deleteDoc(docRef);
}

/**
 * 정기 지출 목록 실시간 구독
 */
export function subscribeToRecurringExpenses(
  householdId: string,
  callback: (expenses: RecurringExpense[]) => void
): () => void {
  if (!householdId) {
    callback([]);
    return () => {};
  }

  const q = query(recurringRef, where('householdId', '==', householdId));

  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      const expenses: RecurringExpense[] = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          householdId: data.householdId,
          merchant: data.merchant,
          amount: data.amount,
          category: data.category,
          dayOfMonth: data.dayOfMonth,
          memo: data.memo,
          isActive: data.isActive ?? true,
          lastRegisteredMonth: data.lastRegisteredMonth,
          createdAt: data.createdAt?.toDate(),
          updatedAt: data.updatedAt?.toDate(),
        };
      });
      callback(expenses);
    },
    (error) => {
      console.error('Recurring expenses subscription error:', error);
      callback([]);
    }
  );

  return unsubscribe;
}

/**
 * 정기 지출 목록 일회성 조회
 */
export async function getRecurringExpenses(householdId: string): Promise<RecurringExpense[]> {
  if (!householdId) return [];

  const q = query(recurringRef, where('householdId', '==', householdId));
  const snapshot = await getDocs(q);

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      householdId: data.householdId,
      merchant: data.merchant,
      amount: data.amount,
      category: data.category,
      dayOfMonth: data.dayOfMonth,
      memo: data.memo,
      isActive: data.isActive ?? true,
      lastRegisteredMonth: data.lastRegisteredMonth,
      createdAt: data.createdAt?.toDate(),
      updatedAt: data.updatedAt?.toDate(),
    };
  });
}

/**
 * 현재 월 문자열 생성 (예: "2024-01")
 */
function getCurrentMonthString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * 오늘 날짜 문자열 생성 (예: "2024-01-15")
 */
function getTodayString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 정기 지출 자동 등록 처리
 * - 오늘 날짜가 dayOfMonth 이상이고
 * - 이번 달에 아직 등록 안 됐으면
 * - 지출 자동 등록
 */
export async function processRecurringExpenses(householdId: string): Promise<number> {
  if (!householdId) return 0;

  const today = new Date();
  const currentDay = today.getDate();
  const currentMonth = getCurrentMonthString();
  const todayString = getTodayString();

  const expenses = await getRecurringExpenses(householdId);
  let registeredCount = 0;

  for (const expense of expenses) {
    // 비활성화된 것은 스킵
    if (!expense.isActive) continue;

    // 이번 달에 이미 등록됐으면 스킵
    if (expense.lastRegisteredMonth === currentMonth) continue;

    // 아직 등록일이 안 됐으면 스킵
    if (currentDay < expense.dayOfMonth) continue;

    // 지출 등록
    try {
      await addExpense({
        householdId,
        date: todayString,
        time: '09:00',
        merchant: expense.merchant,
        amount: expense.amount,
        category: expense.category,
        memo: expense.memo || '',
        cardType: 'etc', // 카드 외 결제
      });

      // lastRegisteredMonth 업데이트
      await updateDoc(doc(db, COLLECTION_NAME, expense.id), {
        lastRegisteredMonth: currentMonth,
        updatedAt: Timestamp.now(),
      });

      registeredCount++;
      console.log(`정기 지출 자동 등록: ${expense.merchant} ${expense.amount}원`);
    } catch (error) {
      console.error(`정기 지출 등록 실패: ${expense.merchant}`, error);
    }
  }

  return registeredCount;
}
