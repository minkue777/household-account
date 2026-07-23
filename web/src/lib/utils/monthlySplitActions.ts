import type { Expense } from '@/types/expense';
import { splitMonthsMinMessage } from '@/lib/utils/splitMonths';

type AsyncVoid = void | Promise<void>;
type AlertFn = (message: string) => void;

export const monthlySplitMessages = {
  invalidMonths: splitMonthsMinMessage,
  splitFailed: '분할 처리 중 오류가 발생했습니다.',
  cancelFailed: '분할 취소 중 오류가 발생했습니다.',
  updateFailed: '수정 중 오류가 발생했습니다.',
} as const;

interface SplitActionBaseOptions {
  expense: Expense;
  onSuccess?: () => AsyncVoid;
  alertFn: AlertFn;
}

interface RunSplitMonthsActionOptions extends SplitActionBaseOptions {
  months: number;
  deleteExpense: (expenseId: string, expectedVersion: number) => AsyncVoid;
}

interface RunUpdateSplitGroupActionOptions extends SplitActionBaseOptions {
  newMonths: number;
}

export async function runSplitMonthsAction({
  expense,
  months,
  deleteExpense: _deleteExpense,
  onSuccess,
  alertFn,
}: RunSplitMonthsActionOptions): Promise<void> {
  if (months < 2) {
    alertFn(monthlySplitMessages.invalidMonths);
    return;
  }

  try {
    void _deleteExpense;
    const { splitExpenseMonthly } = await import('@/lib/expenseService');
    await splitExpenseMonthly(expense, months);
    await onSuccess?.();
  } catch {
    alertFn(monthlySplitMessages.splitFailed);
  }
}

export async function runCancelSplitGroupAction({
  expense,
  onSuccess,
  alertFn,
}: SplitActionBaseOptions): Promise<void> {
  if (!expense.splitGroupId) return;

  try {
    const { cancelSplitGroup } = await import('@/lib/expenseService');
    await cancelSplitGroup(expense.splitGroupId);
    await onSuccess?.();
  } catch {
    alertFn(monthlySplitMessages.cancelFailed);
  }
}

export async function runUpdateSplitGroupAction({
  expense,
  newMonths,
  onSuccess,
  alertFn,
}: RunUpdateSplitGroupActionOptions): Promise<void> {
  if (!expense.splitGroupId) return;

  try {
    const { updateSplitGroup } = await import('@/lib/expenseService');
    await updateSplitGroup(expense.splitGroupId, newMonths);
    await onSuccess?.();
  } catch {
    alertFn(monthlySplitMessages.updateFailed);
  }
}
