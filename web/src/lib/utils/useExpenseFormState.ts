import { useCallback, useState } from 'react';

export interface ExpenseFormStateSnapshot {
  merchant: string;
  amount: string;
  category: string;
  memo: string;
  date: string;
  tags?: string[];
  tagInput?: string;
}

interface UseExpenseFormStateOptions {
  initial: ExpenseFormStateSnapshot;
}

export function useExpenseFormState({ initial }: UseExpenseFormStateOptions) {
  const [formState, setFormState] = useState<ExpenseFormStateSnapshot>(initial);

  const setMerchant = useCallback((merchant: string) => {
    setFormState((prev) => ({ ...prev, merchant }));
  }, []);

  const setAmount = useCallback((amount: string) => {
    setFormState((prev) => ({ ...prev, amount }));
  }, []);

  const setCategory = useCallback((category: string) => {
    setFormState((prev) => ({ ...prev, category }));
  }, []);

  const setMemo = useCallback((memo: string) => {
    setFormState((prev) => ({ ...prev, memo }));
  }, []);

  const setDate = useCallback((date: string) => {
    setFormState((prev) => ({ ...prev, date }));
  }, []);

  const setTags = useCallback((tags: string[]) => {
    setFormState((prev) => ({ ...prev, tags }));
  }, []);

  const setTagInput = useCallback((tagInput: string) => {
    setFormState((prev) => ({ ...prev, tagInput }));
  }, []);

  const resetExpenseFormState = useCallback((next: ExpenseFormStateSnapshot) => {
    setFormState(next);
  }, []);

  return {
    merchant: formState.merchant,
    amount: formState.amount,
    category: formState.category,
    memo: formState.memo,
    date: formState.date,
    tags: formState.tags ?? [],
    tagInput: formState.tagInput ?? '',
    setMerchant,
    setAmount,
    setCategory,
    setMemo,
    setDate,
    setTags,
    setTagInput,
    resetExpenseFormState,
  };
}
