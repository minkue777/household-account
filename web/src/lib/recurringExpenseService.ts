import {
  collection,
  query,
  where,
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
  updates: Partial<CreateRecurringExpenseInput & { isActive: boolean }>,
  expectedVersion: number
): Promise<void> {
  await recurringCommands.update(requireHouseholdId(), id, updates, expectedVersion);
}

/**
 * 정기 지출 삭제
 */
export async function deleteRecurringExpense(id: string, expectedVersion: number): Promise<void> {
  await recurringCommands.delete(requireHouseholdId(), id, expectedVersion);
}

/**
 * 정기 지출 목록 실시간 구독
 */
export function subscribeToRecurringExpenses(
  householdId: string,
  callback: (expenses: RecurringExpense[]) => void,
  onError?: (error: unknown) => void
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
          aggregateVersion: data.aggregateVersion ?? data.version ?? 1,
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
      // 조회 실패의 표시와 재시도는 화면이 소유하며, 마지막 정상 목록은 보존합니다.
      onError?.(error);
    }
  );

  return unsubscribe;
}
