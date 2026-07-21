import {
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  db,
} from '@/platform/read-model/firestoreReadModel';
import { RecurringExpense, CreateRecurringExpenseInput } from '@/types/recurring';
import { recurringCommands } from '@/features/recurring/application/recurringCommands';
import { requireClientSessionScope } from '@/composition/clientSessionScope';

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
const recurringRef = collection(db, COLLECTION_NAME);

function requireHouseholdId(): string {
  return requireClientSessionScope().householdId;
}

/**
 * 정기 지출 추가
 */
export async function addRecurringExpense(
  householdId: string,
  input: CreateRecurringExpenseInput
): Promise<string> {
  if (!householdId) return '';
  return recurringCommands.create(householdId, input);
}

/**
 * 정기 지출 수정
 */
export async function updateRecurringExpense(
  id: string,
  updates: Partial<CreateRecurringExpenseInput & { isActive: boolean }>
): Promise<void> {
  await recurringCommands.update(requireHouseholdId(), id, updates);
}

/**
 * 정기 지출 삭제
 */
export async function deleteRecurringExpense(id: string): Promise<void> {
  await recurringCommands.delete(requireHouseholdId(), id);
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
