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
  runTransaction,
} from 'firebase/firestore';
import { db } from './firebase';
import { RecurringExpense, CreateRecurringExpenseInput } from '@/types/recurring';
import { MemberStorage } from './storage/memberStorage';

export type { RecurringExpense, CreateRecurringExpenseInput };

function sortRecurringExpenses(expenses: RecurringExpense[]) {
  return [...expenses].sort((a, b) => {
    if (a.dayOfMonth !== b.dayOfMonth) {
      return a.dayOfMonth - b.dayOfMonth;
    }

    return a.merchant.localeCompare(b.merchant, 'ko');
  });
}

const COLLECTION_NAME = 'recurring_expenses';
const EXPENSE_COLLECTION_NAME = 'expenses';
const recurringRef = collection(db, COLLECTION_NAME);

/**
 * 정기 지출 추가
 */
export async function addRecurringExpense(
  householdId: string,
  input: CreateRecurringExpenseInput
): Promise<string> {
  if (!householdId) return '';

  const now = new Date();
  const targetDay = getEffectiveDayOfMonth(
    now.getFullYear(),
    now.getMonth() + 1,
    input.dayOfMonth
  );
  const initialLastRegisteredMonth =
    now.getDate() <= targetDay ? getPreviousMonthString(now) : getCurrentMonthString();
  const docRef = await addDoc(recurringRef, {
    householdId,
    merchant: input.merchant,
    amount: input.amount,
    category: input.category,
    dayOfMonth: input.dayOfMonth,
    memo: input.memo || '',
    isActive: true,
    lastRegisteredMonth: initialLastRegisteredMonth,
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
      callback(sortRecurringExpenses(expenses));
    },
    (error) => {
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

  const expenses = snapshot.docs.map((doc) => {
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

  return sortRecurringExpenses(expenses);
}

/**
 * 현재 월 문자열 생성 (예: "2024-01")
 */
export function getCurrentMonthString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * ?? ??? ?? ??? ??? ??
 */
function getEffectiveDayOfMonth(year: number, month: number, dayOfMonth: number): number {
  const lastDayOfMonth = new Date(year, month, 0).getDate();
  return Math.min(dayOfMonth, lastDayOfMonth);
}

/**
 * ?? ?? ?? ?? ?? ??? ?? (?: "2024-01-15")
 */
function getRecurringExpenseDate(year: number, month: number, dayOfMonth: number): string {
  const safeMonth = String(month).padStart(2, '0');
  const safeDay = String(getEffectiveDayOfMonth(year, month, dayOfMonth)).padStart(2, '0');
  return `${year}-${safeMonth}-${safeDay}`;
}

function getRecurringExpenseDocumentId(recurringExpenseId: string, month: string): string {
  return `recurring_${recurringExpenseId}_${month}`;
}

/**
 * ?? ? ??? ?? (?: "2023-12")
 */
function getPreviousMonthString(referenceDate: Date = new Date()): string {
  const previousMonthDate = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - 1, 1);
  const year = previousMonthDate.getFullYear();
  const month = String(previousMonthDate.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
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
  const currentYear = today.getFullYear();
  const currentMonthNumber = today.getMonth() + 1;
  const currentMonth = getCurrentMonthString();

  const expenses = await getRecurringExpenses(householdId);
  const createdBy = MemberStorage.getMemberName();
  let registeredCount = 0;

  for (const expense of expenses) {
    // 비활성화된 것은 스킵
    if (!expense.isActive) continue;

    // 이번 달에 이미 등록됐으면 스킵
    if (expense.lastRegisteredMonth === currentMonth) continue;

    // 아직 등록일이 안 됐으면 스킵
    const targetDay = getEffectiveDayOfMonth(currentYear, currentMonthNumber, expense.dayOfMonth);

    if (currentDay < targetDay) continue;

    // 지출 등록
    try {
      const wasRegistered = await runTransaction(db, async (transaction) => {
        const recurringDocRef = doc(db, COLLECTION_NAME, expense.id);
        const recurringDocSnap = await transaction.get(recurringDocRef);

        if (!recurringDocSnap.exists()) return false;

        const recurringData = recurringDocSnap.data();
        if (recurringData.householdId !== householdId) return false;
        if ((recurringData.isActive ?? true) === false) return false;
        if (recurringData.lastRegisteredMonth === currentMonth) return false;

        const dayOfMonth = recurringData.dayOfMonth ?? expense.dayOfMonth;
        const targetDayInTransaction = getEffectiveDayOfMonth(
          currentYear,
          currentMonthNumber,
          dayOfMonth
        );

        if (currentDay < targetDayInTransaction) return false;

        const expenseDocRef = doc(
          db,
          EXPENSE_COLLECTION_NAME,
          getRecurringExpenseDocumentId(expense.id, currentMonth)
        );
        const expenseDocSnap = await transaction.get(expenseDocRef);
        const now = Timestamp.now();

        if (expenseDocSnap.exists()) {
          transaction.update(recurringDocRef, {
            lastRegisteredMonth: currentMonth,
            updatedAt: now,
          });
          return false;
        }

        transaction.set(expenseDocRef, {
          householdId,
          date: getRecurringExpenseDate(currentYear, currentMonthNumber, dayOfMonth),
          time: '09:00',
          merchant: recurringData.merchant,
          amount: recurringData.amount,
          transactionType: 'expense',
          category: recurringData.category,
          cardLastFour: '정기지출',
          memo: recurringData.memo || '',
          cardType: 'main',
          recurringExpenseId: expense.id,
          recurringMonth: currentMonth,
          createdAt: now,
          ...(createdBy && { createdBy }),
        });

        transaction.update(recurringDocRef, {
          lastRegisteredMonth: currentMonth,
          updatedAt: now,
        });

        return true;
      });

      if (wasRegistered) {
        registeredCount++;
      }
    } catch (error) {
    }
  }

  return registeredCount;
}
