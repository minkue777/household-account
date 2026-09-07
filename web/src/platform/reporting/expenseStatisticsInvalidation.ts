import { getClientSessionScope, type ClientSessionScope } from '@/composition/clientSessionScope';
import type { LedgerTransactionCommandResult } from '@/platform/functions-api/householdCommandContract';

export interface ExpenseStatisticsConfirmedUpdate {
  transactionId: string;
  expectedVersion: number;
  transaction: LedgerTransactionCommandResult;
}

export interface ExpenseStatisticsMutation extends ExpenseStatisticsConfirmedUpdate {
  scope: ClientSessionScope;
}

let revision = 0;
const listeners = new Set<(mutation?: ExpenseStatisticsMutation) => void>();

export function expenseStatisticsActorKey(scope: ClientSessionScope | undefined): string {
  return scope ? JSON.stringify([scope.principalUid, scope.memberId, scope.householdId,
    scope.sessionGeneration, scope.accessMode ?? 'member']) : '';
}

export function getExpenseStatisticsRevision(): number { return revision; }
export function subscribeExpenseStatisticsInvalidation(listener: (mutation?: ExpenseStatisticsMutation) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function invalidateExpenseStatistics(): void {
  publishInvalidation();
}

function publishInvalidation(mutation?: ExpenseStatisticsMutation): void {
  revision += 1;
  listeners.forEach(listener => listener(mutation));
}

/** A late command from a departed actor must not invalidate the next actor's reads. */
export function notifyExpenseStatisticsMutation(
  scope: ClientSessionScope | undefined,
  householdId?: string,
  update?: ExpenseStatisticsConfirmedUpdate
): void {
  if (scope && scope.householdId === householdId
    && expenseStatisticsActorKey(scope) === expenseStatisticsActorKey(getClientSessionScope())) {
    publishInvalidation(update ? { ...update, scope } : undefined);
  }
}
