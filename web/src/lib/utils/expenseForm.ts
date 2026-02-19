type CategoryKey = string;

interface MinimalCategory {
  key: string;
}

interface BuildExpenseUpdatesParams {
  original: {
    merchant: string;
    amount: number;
    category: CategoryKey;
    memo?: string;
  };
  draft: {
    merchant: string;
    amountInput: string;
    category: CategoryKey;
    memo: string;
  };
}

export interface ExpenseUpdates {
  amount?: number;
  memo?: string;
  category?: string;
  merchant?: string;
}

export function trimExpenseMerchant(merchant: string): string {
  return merchant.trim();
}

export function parsePositiveExpenseAmount(amountInput: string): number | null {
  const parsed = Number.parseInt(amountInput, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

export function isExpenseSubmitEnabled(merchant: string, amountInput: string): boolean {
  return Boolean(trimExpenseMerchant(merchant)) && parsePositiveExpenseAmount(amountInput) !== null;
}

export function toOptionalMemo(memo: string): string | undefined {
  const trimmed = memo.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveDefaultCategoryKey(
  categories: MinimalCategory[],
  fallbackCategory: string = 'etc'
): string {
  if (categories.length === 0) {
    return fallbackCategory;
  }
  return categories[0].key;
}

export function buildExpenseUpdates({
  original,
  draft,
}: BuildExpenseUpdatesParams): ExpenseUpdates | null {
  const trimmedMerchant = trimExpenseMerchant(draft.merchant);
  const amount = parsePositiveExpenseAmount(draft.amountInput);

  if (!trimmedMerchant || amount === null) {
    return null;
  }

  const updates: ExpenseUpdates = {};

  if (trimmedMerchant !== original.merchant) {
    updates.merchant = trimmedMerchant;
  }

  if (amount !== original.amount) {
    updates.amount = amount;
  }

  if (draft.memo !== (original.memo || '')) {
    updates.memo = draft.memo;
  }

  if (draft.category !== original.category) {
    updates.category = draft.category;
  }

  return updates;
}

