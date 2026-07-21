import { getHouseholdCommandClient } from '@/composition/webCommandRuntime';
import type { Expense } from '@/types/expense';

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

export const ledgerCommands = {
  async record(
    householdId: string,
    transaction: Omit<Expense, 'id' | 'aggregateVersion'>
  ): Promise<string> {
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
    const result = await getHouseholdCommandClient().execute(
      'ledger.record-manual-transaction.v1',
      payload,
      { householdId }
    );
    return result.transactionId;
  },

  async update(
    householdId: string,
    transactionId: string,
    expectedVersion: number,
    changes: Partial<Expense>
  ): Promise<void> {
    await getHouseholdCommandClient().execute(
      'ledger.update-transaction.v1',
      { transactionId, expectedVersion, patch: toTransactionPatch(changes) },
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
    return getHouseholdCommandClient().execute(
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
    await getHouseholdCommandClient().execute(
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
    return getHouseholdCommandClient().execute(
      'ledger.split-existing-transaction-monthly.v1',
      { transactionId, expectedVersion, months },
      { householdId }
    );
  },

  async delete(householdId: string, transactionId: string, expectedVersion: number): Promise<void> {
    await getHouseholdCommandClient().execute(
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
  ): Promise<void> {
    await getHouseholdCommandClient().execute(
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
    const result = await getHouseholdCommandClient().execute(
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
    sourceExpectedVersion: number
  ): Promise<void> {
    await getHouseholdCommandClient().execute(
      'ledger.merge-transactions.v1',
      {
        targetTransactionId,
        sourceTransactionId,
        expectedVersions: {
          [targetTransactionId]: targetExpectedVersion,
          [sourceTransactionId]: sourceExpectedVersion,
        },
      },
      { householdId }
    );
  },

  async unmerge(
    householdId: string,
    transactionId: string,
    expectedVersion: number
  ): Promise<string[]> {
    const result = await getHouseholdCommandClient().execute(
      'ledger.unmerge-transaction.v1',
      { transactionId, expectedVersion },
      { householdId }
    );
    return result.transactionIds;
  },

  async cancelMonthlySplit(
    householdId: string,
    splitGroupId: string,
    expectedVersions: Record<string, number>
  ): Promise<void> {
    await getHouseholdCommandClient().execute(
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
    const result = await getHouseholdCommandClient().execute(
      'ledger.reconfigure-monthly-split.v1',
      { splitGroupId, months, expectedVersions },
      { householdId }
    );
    return result.splitGroupId;
  },
};
