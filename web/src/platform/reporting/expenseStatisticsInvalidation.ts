import { getClientSessionScope, type ClientSessionScope } from '@/composition/clientSessionScope';

let revision = 0;
const listeners = new Set<() => void>();

export function expenseStatisticsActorKey(scope: ClientSessionScope | undefined): string {
  return scope ? JSON.stringify([scope.principalUid, scope.memberId, scope.householdId,
    scope.sessionGeneration, scope.accessMode ?? 'member']) : '';
}

export function getExpenseStatisticsRevision(): number { return revision; }
export function subscribeExpenseStatisticsInvalidation(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function invalidateExpenseStatistics(): void {
  revision += 1;
  listeners.forEach(listener => listener());
}

/** A late command from a departed actor must not invalidate the next actor's reads. */
export function notifyExpenseStatisticsMutation(scope: ClientSessionScope | undefined, householdId?: string): void {
  if (scope && scope.householdId === householdId
    && expenseStatisticsActorKey(scope) === expenseStatisticsActorKey(getClientSessionScope())) {
    invalidateExpenseStatistics();
  }
}
