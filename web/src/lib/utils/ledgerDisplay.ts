import { Expense, TransactionType } from '@/types/expense';

export function getLedgerPrimaryText(expense: Expense, transactionType: TransactionType): string {
  if (transactionType === 'income') {
    const memo = expense.memo?.trim();
    if (memo) {
      return memo;
    }

    const merchant = expense.merchant?.trim();
    if (merchant && merchant !== '수입') {
      return merchant;
    }

    return '수입';
  }

  return expense.merchant;
}

export function getLedgerSecondaryText(expense: Expense, transactionType: TransactionType): string | undefined {
  if (transactionType === 'income') {
    const merchant = expense.merchant?.trim();
    if (merchant && merchant !== '수입') {
      return merchant;
    }
    return undefined;
  }

  return expense.memo;
}
