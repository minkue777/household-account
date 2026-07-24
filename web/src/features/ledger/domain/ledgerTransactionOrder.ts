import type { Expense } from '@/types/expense';

export function compareLedgerTransactions(left: Expense, right: Expense): number {
  return right.date.localeCompare(left.date)
    || (right.time ?? '').localeCompare(left.time ?? '')
    || right.id.localeCompare(left.id);
}

export function orderLedgerTransactions(
  transactions: readonly Expense[]
): Expense[] {
  return [...transactions].sort(compareLedgerTransactions);
}
