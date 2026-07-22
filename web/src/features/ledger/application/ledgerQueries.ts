import { getHouseholdQueryClient } from '@/composition/webQueryRuntime';
import type { TransactionType } from '@/types/expense';

export const ledgerQueries = {
  listTransactions(
    startDate: string,
    endDate: string,
    transactionType: TransactionType
  ) {
    return getHouseholdQueryClient().execute('ledger.list-transactions.v1', {
      startDate,
      endDate,
      transactionType,
    });
  },
};
