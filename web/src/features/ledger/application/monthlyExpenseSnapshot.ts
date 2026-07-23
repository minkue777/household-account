import { requireClientSessionScope } from '@/composition/clientSessionScope';
import type { Expense, TransactionType } from '@/types/expense';

const DEFAULT_TRANSACTION_TYPE: TransactionType = 'expense';
const MONTHLY_SNAPSHOT_VERSION = 1;
const MONTHLY_SNAPSHOT_PREFIX = 'household-account.monthly-ledger.v1';

function monthlySnapshotKey(
  householdId: string,
  year: number,
  month: number,
  transactionType: TransactionType
): string {
  return [
    MONTHLY_SNAPSHOT_PREFIX,
    householdId,
    `${year}-${String(month).padStart(2, '0')}`,
    transactionType,
  ].join(':');
}

function isCachedExpense(
  value: unknown,
  startDate: string,
  endDate: string,
  transactionType: TransactionType
): value is Expense {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string'
    && item.id.trim() !== ''
    && Number.isInteger(item.aggregateVersion)
    && Number(item.aggregateVersion) > 0
    && typeof item.date === 'string'
    && item.date >= startDate
    && item.date <= endDate
    && typeof item.merchant === 'string'
    && typeof item.amount === 'number'
    && Number.isFinite(item.amount)
    && typeof item.category === 'string'
    && (item.transactionType ?? DEFAULT_TRANSACTION_TYPE) === transactionType;
}

export function readMonthlyExpenseSnapshot(
  year: number,
  month: number,
  transactionType: TransactionType = DEFAULT_TRANSACTION_TYPE
): Expense[] | undefined {
  if (typeof window === 'undefined') return undefined;
  let householdId: string;
  try {
    householdId = requireClientSessionScope().householdId;
  } catch {
    return undefined;
  }
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = `${year}-${String(month).padStart(2, '0')}-31`;
  try {
    const raw = window.localStorage.getItem(
      monthlySnapshotKey(householdId, year, month, transactionType)
    );
    if (!raw) return undefined;
    const stored = JSON.parse(raw) as {
      version?: unknown;
      householdId?: unknown;
      items?: unknown;
    };
    if (
      stored.version !== MONTHLY_SNAPSHOT_VERSION
      || stored.householdId !== householdId
      || !Array.isArray(stored.items)
      || !stored.items.every((item) =>
        isCachedExpense(item, startDate, endDate, transactionType)
      )
    ) {
      return undefined;
    }
    return stored.items.map((item) => ({ ...(item as Expense) }));
  } catch {
    return undefined;
  }
}

export function writeMonthlyExpenseSnapshot(
  householdId: string,
  year: number,
  month: number,
  transactionType: TransactionType,
  items: readonly Expense[]
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      monthlySnapshotKey(householdId, year, month, transactionType),
      JSON.stringify({
        version: MONTHLY_SNAPSHOT_VERSION,
        householdId,
        writtenAt: Date.now(),
        items,
      })
    );
  } catch {
    // localStorage가 가득 찼거나 비활성화되어도 authoritative 구독은 계속 동작합니다.
  }
}
