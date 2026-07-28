import { OptimisticEntityProjection } from '@/platform/read-model/optimisticEntityProjection';
import { registerClientSessionReset } from '@/composition/clientSessionResetRegistry';
import { compareLedgerTransactions } from '@/features/ledger/domain/ledgerTransactionOrder';
import type { Expense } from '@/types/expense';

type LedgerPatch = Partial<Pick<
  Expense,
  'merchant' | 'memo' | 'amount' | 'category' | 'date'
>>;

/**
 * 월 분할 취소 직후 원본 복구와 파생 항목 삭제가 서로 다른 read emission으로
 * 관찰되더라도 같은 화면에 둘을 함께 노출하지 않습니다.
 */
export function reconcileRestoredMonthlySplit(
  expenses: readonly Expense[]
): Expense[] {
  const visibleIds = new Set(expenses.map(({ id }) => id));
  return expenses.filter(
    ({ splitOriginalId }) =>
      splitOriginalId === undefined || !visibleIds.has(splitOriginalId)
  );
}

/** Ledger가 허용하는 patch만 공통 optimistic projection에 노출합니다. */
export class LedgerOptimisticProjection {
  private readonly projections = new Map<string, OptimisticEntityProjection<Expense>>();
  private readonly mutationScopes = new Map<string, string>();

  subscribe(
    callback: (expenses: Expense[]) => void,
    accept: (expense: Expense) => boolean,
    scope = 'default',
    retentionKey?: string
  ) {
    return this.projectionFor(scope).subscribe(
      (expenses) => callback(reconcileRestoredMonthlySplit(expenses)),
      accept,
      retentionKey
    );
  }

  current(transactionId: string, scope = 'default'): Expense | undefined {
    return this.projectionFor(scope).current(transactionId);
  }

  beginUpdate(transactionId: string, patch: LedgerPatch, scope = 'default'): string {
    return this.track(scope, this.projectionFor(scope).beginUpdate(transactionId, patch));
  }

  beginCreate(transaction: Expense, scope = 'default'): string {
    return this.track(scope, this.projectionFor(scope).beginCreate(transaction));
  }

  beginDelete(transactionId: string, scope = 'default'): string {
    return this.track(scope, this.projectionFor(scope).beginDelete(transactionId));
  }

  commitUpdate(id: string, canonical: Expense): void {
    this.withMutation(id, (projection) => projection.commitUpdate(id, canonical));
  }

  commitCreate(id: string, canonical: Expense): void {
    this.withMutation(id, (projection) => projection.commitCreate(id, canonical));
  }

  commitDelete(id: string): void {
    this.withMutation(id, (projection) => projection.commitDelete(id));
  }

  rollback(id: string): void {
    this.withMutation(id, (projection) => projection.rollback(id));
  }

  reset(): void {
    this.projections.forEach((projection) => projection.reset());
    this.projections.clear();
    this.mutationScopes.clear();
  }

  private projectionFor(scope: string): OptimisticEntityProjection<Expense> {
    const existing = this.projections.get(scope);
    if (existing) return existing;
    const projection = new OptimisticEntityProjection<Expense>(
      'ledger',
      compareLedgerTransactions
    );
    this.projections.set(scope, projection);
    return projection;
  }

  private track(scope: string, mutationId: string): string {
    this.mutationScopes.set(mutationId, scope);
    return mutationId;
  }

  private withMutation(
    mutationId: string,
    action: (projection: OptimisticEntityProjection<Expense>) => void
  ): void {
    const scope = this.mutationScopes.get(mutationId);
    if (scope === undefined) return;
    action(this.projectionFor(scope));
    this.mutationScopes.delete(mutationId);
  }
}

export const ledgerOptimisticProjection = new LedgerOptimisticProjection();

registerClientSessionReset(() => ledgerOptimisticProjection.reset());
