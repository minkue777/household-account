import { useCallback, useState } from 'react';
import type { Expense } from '@/types/expense';

export function useExpenseEditor() {
  const [selection, setSelection] = useState<{ expense: Expense | null; key: number }>({
    expense: null,
    key: 0,
  });
  const selectExpense = useCallback((expense: Expense | null) => {
    // Even the same transaction is a new editor when the user selects it again.
    // Pending commands belong to the previous instance, not this new draft.
    setSelection(previous => ({ expense, key: previous.key + (expense ? 1 : 0) }));
  }, []);

  return { expense: selection.expense, selectExpense, editorKey: selection.key };
}
