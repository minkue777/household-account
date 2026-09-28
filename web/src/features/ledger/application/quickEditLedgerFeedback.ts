import type { QuickEditUpdateFeedbackSnapshot } from '@/platform/android-host/quickEditUpdateFeedback';
import { mapCommandTransaction } from './ledgerExpenseMapping';
import type { LedgerOptimisticProjection } from './ledgerOptimisticProjection';

/** Native is only another input adapter to the ordinary ledger optimistic lifecycle. */
export class QuickEditLedgerFeedback {
  private readonly pending = new Map<string, string>();
  private readonly settled = new Set<string>();
  private latest?: QuickEditUpdateFeedbackSnapshot;
  private applying = false;
  private readonly stopObserving: () => void;

  constructor(
    private readonly projection: LedgerOptimisticProjection,
    private readonly householdId: string,
    private readonly onSettled: (commandIds: string[], nativeGeneration: number) => void,
    private readonly isCurrent: () => boolean = () => true
  ) {
    this.stopObserving = projection.observeChanges(() => this.apply());
  }

  receive(snapshot: QuickEditUpdateFeedbackSnapshot): void {
    if (snapshot.householdId !== this.householdId) return;
    if (this.latest && this.latest.nativeSessionGeneration !== snapshot.nativeSessionGeneration) {
      this.latest = undefined;
      this.clearPending();
      this.settled.clear();
    }
    this.latest = snapshot;
    this.apply();
  }

  dispose(): void {
    this.stopObserving();
    this.latest = undefined;
    this.clearPending();
    this.settled.clear();
  }

  private clearPending(): void {
    const ids = Array.from(this.pending.values());
    this.pending.clear();
    ids.forEach((id) => this.projection.rollback(id));
  }

  private apply(): void {
    if (this.applying || !this.latest || !this.isCurrent()) return;
    this.applying = true;
    try {
      const { updates, nativeSessionGeneration } = this.latest;
      const present = new Set(updates.map((entry) => entry.commandId));
      this.pending.forEach((mutationId, commandId) => {
        if (!present.has(commandId)) {
          this.pending.delete(commandId);
          this.projection.rollback(mutationId);
        }
      });
      this.settled.forEach((id) => { if (!present.has(id)) this.settled.delete(id); });
      for (const entry of updates) {
        if (this.settled.has(entry.commandId)) continue;
        let mutationId = this.pending.get(entry.commandId);
        if (entry.state === 'failed') {
          if (mutationId) this.projection.rollback(mutationId);
          this.pending.delete(entry.commandId);
          this.settled.add(entry.commandId);
          continue;
        }
        try {
          const source = this.projection.sourceCurrent(entry.transactionId, this.householdId);
          if (!source) {
            if (mutationId) {
              this.projection.rollback(mutationId);
              this.pending.delete(entry.commandId);
            }
            // First entry has a server-first read. A retained old completion must
            // never manufacture a row that a newer read already deleted/split.
            if (entry.state === 'succeeded') this.settled.add(entry.commandId);
            continue;
          }
          if (!mutationId) {
            const { merchant, memo, amountInWon, categoryId, accountingDate, tags } = entry.patch;
            mutationId = this.projection.beginUpdate(entry.transactionId, {
              ...(merchant === undefined ? {} : { merchant }),
              ...(memo === undefined ? {} : { memo }),
              ...(amountInWon === undefined ? {} : { amount: amountInWon }),
              ...(categoryId === undefined ? {} : { category: categoryId }),
              ...(accountingDate === undefined ? {} : { date: accountingDate }),
              ...(tags === undefined ? {} : { tags }),
            }, this.householdId, entry.expectedVersion);
            this.pending.set(entry.commandId, mutationId);
          }
          if (entry.state === 'succeeded' && entry.transaction) {
            this.projection.commitUpdate(mutationId, mapCommandTransaction(entry.transaction, source));
            this.pending.delete(entry.commandId);
            this.settled.add(entry.commandId);
          }
        } catch (error) {
          // A Web edit already in flight owns its overlay. Retry after its ordinary
          // commit/rollback or source publication, without overwriting that edit.
          if (!(error instanceof Error) || error.message !== 'LEDGER_MUTATION_ALREADY_PENDING') throw error;
        }
      }
      const acknowledgements = updates.filter(({ commandId, state }) =>
        state !== 'pending' && this.settled.has(commandId)).map(({ commandId }) => commandId);
      if (acknowledgements.length) this.onSettled(acknowledgements, nativeSessionGeneration);
    } finally {
      this.applying = false;
    }
  }
}
