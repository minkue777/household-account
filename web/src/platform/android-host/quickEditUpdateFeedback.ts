import type { LedgerTransactionCommandResult } from '@/platform/functions-api/householdCommandContract';

export const QUICK_EDIT_UPDATES_CHANGED_EVENT = 'household-account:quick-edit-updates-changed';
export interface QuickEditFeedbackScope {
  principalUid: string;
  householdId: string;
  memberId: string;
}
export interface QuickEditUpdateFeedback {
  commandId: string;
  transactionId: string;
  expectedVersion: number;
  patch: {
    merchant?: string;
    memo?: string;
    amountInWon?: number;
    categoryId?: string;
    accountingDate?: string;
    tags?: string[];
  };
  state: 'pending' | 'succeeded' | 'failed';
  transaction?: LedgerTransactionCommandResult;
}
export interface QuickEditUpdateFeedbackSnapshot extends QuickEditFeedbackScope {
  contractVersion: 'quick-edit-update-feedback.v1';
  nativeSessionGeneration: number;
  updates: QuickEditUpdateFeedback[];
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** A trusted origin still needs a versioned, scoped, fail-closed native wire boundary. */
export function readQuickEditUpdateFeedback(
  value: unknown,
  scope: QuickEditFeedbackScope
): QuickEditUpdateFeedbackSnapshot | undefined {
  if (!record(value) || value.contractVersion !== 'quick-edit-update-feedback.v1'
    || value.principalUid !== scope.principalUid || value.householdId !== scope.householdId
    || value.memberId !== scope.memberId || !positiveInteger(value.nativeSessionGeneration)
    || !Array.isArray(value.updates)) return;
  const ids = new Set<string>();
  for (const update of value.updates) {
    if (!record(update) || typeof update.commandId !== 'string' || !update.commandId
      || ids.has(update.commandId) || typeof update.transactionId !== 'string' || !update.transactionId
      || !positiveInteger(update.expectedVersion) || !record(update.patch)
      || !['pending', 'succeeded', 'failed'].includes(String(update.state))) return;
    ids.add(update.commandId);
    const patch = update.patch;
    if (['merchant', 'memo', 'categoryId', 'accountingDate'].some(
      (key) => patch[key] !== undefined && typeof patch[key] !== 'string'
    ) || (patch.amountInWon !== undefined && !positiveInteger(patch.amountInWon))
      || (patch.tags !== undefined && !strings(patch.tags))) return;
    if (update.state === 'succeeded') {
      const tx = update.transaction;
      if (!record(tx) || tx.transactionId !== update.transactionId || tx.householdId !== scope.householdId
        || !positiveInteger(tx.aggregateVersion) || tx.aggregateVersion <= update.expectedVersion
        || tx.lifecycleState !== 'active' || !['expense', 'income'].includes(String(tx.transactionType))
        || !['manual', 'captured'].includes(String(tx.cardType)) || !positiveInteger(tx.amountInWon)
        || ['merchant', 'memo', 'categoryId', 'accountingDate', 'localTime', 'cardDisplay', 'creatorMemberId']
          .some((key) => typeof tx[key] !== 'string')
        || (tx.tags !== undefined && !strings(tx.tags))) return;
    }
  }
  return value as unknown as QuickEditUpdateFeedbackSnapshot;
}
