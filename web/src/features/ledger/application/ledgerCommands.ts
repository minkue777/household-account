import { getHouseholdCommandClient } from '@/composition/webCommandRuntime';
import { getClientSessionScope } from '@/composition/clientSessionScope';
import { notifyExpenseStatisticsMutation } from '@/platform/reporting/expenseStatisticsInvalidation';
import type { HouseholdCommandName, HouseholdCommandPayloads, HouseholdCommandResults } from '@/platform/functions-api/householdCommandContract';
import type { ExecuteHouseholdCommandOptions } from '@/platform/functions-api/householdCommandClient';
import type { Expense } from '@/types/expense';
import {
  ledgerMergedTransactionId,
  type LedgerTransactionCommandResult,
} from '@/platform/functions-api/householdCommandContract';
import { createHouseholdCommandId } from '@/platform/functions-api/householdCommandClient';

export interface LedgerSplitItem {
  merchant: string;
  amount: number;
  category: string;
  memo?: string;
}

export interface LedgerTransactionPatch {
  merchant?: string;
  memo?: string;
  amountInWon?: number;
  categoryId?: string;
  accountingDate?: string;
}

function toTransactionPatch(changes: Partial<Expense>): LedgerTransactionPatch {
  return {
    ...(changes.merchant !== undefined ? { merchant: changes.merchant } : {}),
    ...(changes.memo !== undefined ? { memo: changes.memo } : {}),
    ...(changes.amount !== undefined ? { amountInWon: changes.amount } : {}),
    ...(changes.category !== undefined ? { categoryId: changes.category } : {}),
    ...(changes.date !== undefined ? { accountingDate: changes.date } : {}),
  };
}

async function executeLedgerCommand<Name extends HouseholdCommandName>(
  command: Name,
  payload: HouseholdCommandPayloads[Name],
  options: ExecuteHouseholdCommandOptions
): Promise<HouseholdCommandResults[Name]> {
  const scope = getClientSessionScope();
  const result = await getHouseholdCommandClient().execute(command, payload, options);
  if (command !== 'ledger.request-notification.v1') notifyExpenseStatisticsMutation(scope, options.householdId);
  return result;
}

export const ledgerCommands = {
  async record(
    householdId: string,
    transaction: Omit<Expense, 'id' | 'aggregateVersion'>,
    commandId?: string
  ): Promise<LedgerTransactionCommandResult> {
    const common = {
      amountInWon: transaction.amount,
      accountingDate: transaction.date,
      ...(transaction.memo !== undefined ? { memo: transaction.memo } : {}),
    };
    const payload = transaction.transactionType === 'income'
      ? { ...common, transactionType: 'income' as const, itemName: transaction.merchant }
      : {
          ...common,
          transactionType: 'expense' as const,
          merchant: transaction.merchant,
          categoryId: transaction.category,
        };
    const result = await executeLedgerCommand(
      'ledger.record-manual-transaction.v1',
      payload,
      { householdId, ...(commandId ? { commandId, idempotencyKey: commandId } : {}) }
    );
    return result;
  },

  async update(
    householdId: string,
    transactionId: string,
    expectedVersion: number,
    changes: Partial<Expense>,
    rememberForNextTime = false
  ): Promise<LedgerTransactionCommandResult> {
    return executeLedgerCommand(
      'ledger.update-transaction.v1',
      { transactionId, expectedVersion, patch: toTransactionPatch(changes), ...(rememberForNextTime ? { rememberForNextTime: true } : {}) },
      { householdId }
    );
  },

  async recordMonthlySplit(
    householdId: string,
    input: {
      merchant: string;
      amountInWon: number;
      categoryId: string;
      accountingDate: string;
      memo?: string;
      months: number;
    }
  ): Promise<{ transactionIds: string[]; splitGroupId: string }> {
    return executeLedgerCommand(
      'ledger.record-manual-monthly-split.v1',
      { ...input, transactionType: 'expense' },
      { householdId }
    );
  },

  async requestNotification(
    householdId: string,
    transactionId: string,
    expectedVersion: number
  ): Promise<void> {
    await executeLedgerCommand(
      'ledger.request-notification.v1',
      { transactionId, expectedVersion },
      { householdId }
    );
  },

  async splitExistingMonthly(
    householdId: string,
    transactionId: string,
    expectedVersion: number,
    months: number
  ): Promise<{ transactionIds: string[]; splitGroupId: string }> {
    return executeLedgerCommand(
      'ledger.split-existing-transaction-monthly.v1',
      { transactionId, expectedVersion, months },
      { householdId }
    );
  },

  async delete(
    householdId: string,
    transactionId: string,
    expectedVersion: number
  ): Promise<LedgerTransactionCommandResult> {
    return executeLedgerCommand(
      'ledger.delete-transaction.v1',
      { transactionId, expectedVersion },
      { householdId }
    );
  },

  async changeCategory(
    householdId: string,
    transactionId: string,
    categoryId: string,
    expectedVersion: number
  ): Promise<LedgerTransactionCommandResult> {
    return executeLedgerCommand(
      'ledger.change-transaction-category.v1',
      { transactionId, categoryId, expectedVersion },
      { householdId }
    );
  },

  async split(
    householdId: string,
    transactionId: string,
    expectedVersion: number,
    items: readonly LedgerSplitItem[]
  ): Promise<string[]> {
    const result = await executeLedgerCommand(
      'ledger.split-transaction.v1',
      {
        transactionId,
        items: items.map((item) => ({
          merchant: item.merchant,
          amountInWon: item.amount,
          categoryId: item.category,
          ...(item.memo !== undefined ? { memo: item.memo } : {}),
        })),
        expectedVersion,
      },
      { householdId }
    );
    return result.transactionIds;
  },

  async merge(
    householdId: string,
    targetTransactionId: string,
    targetExpectedVersion: number,
    sourceTransactionId: string,
    sourceExpectedVersion: number,
    commandId = createHouseholdCommandId('ledger-merge')
  ): Promise<{ transactionId: string }> {
    const result = await executeLedgerCommand(
      'ledger.merge-transactions.v1',
      {
        targetTransactionId,
        sourceTransactionId,
        expectedVersions: {
          [targetTransactionId]: targetExpectedVersion,
          [sourceTransactionId]: sourceExpectedVersion,
        },
      },
      { householdId, commandId, idempotencyKey: commandId }
    );
    const deterministicId = ledgerMergedTransactionId(commandId);
    const authoritativeId = result.transactionId ?? result.transactionIds?.[0];
    if (authoritativeId !== undefined && authoritativeId !== deterministicId) {
      throw new Error('LEDGER_MERGED_TRANSACTION_ID_MISMATCH');
    }
    return { transactionId: authoritativeId ?? deterministicId };
  },

  async unmerge(
    householdId: string,
    transactionId: string,
    expectedVersion: number
  ): Promise<string[]> {
    const result = await executeLedgerCommand(
      'ledger.unmerge-transaction.v1',
      { transactionId, expectedVersion },
      { householdId }
    );
    return result.transactionIds;
  },

  async restoreItemSplit(householdId: string, sourceId: string, expectedVersions: Record<string, number>): Promise<string> {
    const result = await executeLedgerCommand('ledger.restore-item-split.v1', { sourceId, expectedVersions }, { householdId });
    return result.transactionId;
  },

  async cancelMonthlySplit(
    householdId: string,
    splitGroupId: string,
    expectedVersions: Record<string, number>
  ): Promise<void> {
    await executeLedgerCommand(
      'ledger.cancel-monthly-split.v1',
      { splitGroupId, expectedVersions },
      { householdId }
    );
  },

  async reconfigureMonthlySplit(
    householdId: string,
    splitGroupId: string,
    months: number,
    expectedVersions: Record<string, number>
  ): Promise<string> {
    const result = await executeLedgerCommand(
      'ledger.reconfigure-monthly-split.v1',
      { splitGroupId, months, expectedVersions },
      { householdId }
    );
    return result.splitGroupId;
  },
};
