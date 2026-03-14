import { Expense } from '@/types/expense';
import {
  addExpense,
  cancelSplitGroup,
  generateSplitGroupId,
  updateSplitGroup,
} from '@/lib/expenseService';
import { getMonthlySplitDate } from '@/lib/utils/monthlySplitDate';
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
  alertFn?: AlertFn;
}

interface RunSplitMonthsActionOptions extends SplitActionBaseOptions {
  months: number;
  deleteExpense: (expenseId: string) => AsyncVoid;
}

interface RunUpdateSplitGroupActionOptions extends SplitActionBaseOptions {
  newMonths: number;
}

function getAlertFn(alertFn?: AlertFn): AlertFn {
  return alertFn ?? ((message) => alert(message));
}

export async function runSplitMonthsAction({
  expense,
  months,
  deleteExpense,
  onSuccess,
  alertFn,
}: RunSplitMonthsActionOptions): Promise<void> {
  const showAlert = getAlertFn(alertFn);

  if (months < 2) {
    showAlert(monthlySplitMessages.invalidMonths);
    return;
  }

  const monthlyAmount = Math.floor(expense.amount / months);
  const splitGroupId = generateSplitGroupId();

  try {
    for (let i = 0; i < months; i++) {
      const dateStr = getMonthlySplitDate(expense.date, i);

      await addExpense({
        date: dateStr,
        time: expense.time || '09:00',
        merchant: `${expense.merchant} (${i + 1}/${months})`,
        amount: monthlyAmount,
        category: expense.category,
        cardType: expense.cardType || 'main',
        memo: expense.memo,
        splitGroupId,
        splitIndex: i + 1,
        splitTotal: months,
      }, {
        notifyOnCreate: false,
      });
    }

    await deleteExpense(expense.id);
    await onSuccess?.();
  } catch {
    showAlert(monthlySplitMessages.splitFailed);
  }
}

export async function runCancelSplitGroupAction({
  expense,
  onSuccess,
  alertFn,
}: SplitActionBaseOptions): Promise<void> {
  if (!expense.splitGroupId) return;

  const showAlert = getAlertFn(alertFn);

  try {
    await cancelSplitGroup(expense.splitGroupId);
    await onSuccess?.();
  } catch {
    showAlert(monthlySplitMessages.cancelFailed);
  }
}

export async function runUpdateSplitGroupAction({
  expense,
  newMonths,
  onSuccess,
  alertFn,
}: RunUpdateSplitGroupActionOptions): Promise<void> {
  if (!expense.splitGroupId) return;

  const showAlert = getAlertFn(alertFn);

  try {
    await updateSplitGroup(expense.splitGroupId, newMonths);
    await onSuccess?.();
  } catch {
    showAlert(monthlySplitMessages.updateFailed);
  }
}
