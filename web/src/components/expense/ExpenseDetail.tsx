'use client';

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import type { Expense, TransactionType } from '@/types/expense';
import type { SplitItem } from '@/lib/expenseService';
import {
  runCancelSplitGroupAction,
  runSplitMonthsAction,
  runUpdateSplitGroupAction,
} from '@/lib/utils/monthlySplitActions';
import ExpenseItem from './ExpenseItem';
import ExpenseEditModal from './ExpenseEditModal';
import ExpenseSplitModal from './ExpenseSplitModal';
import { useDragAndDrop } from './hooks/useDragAndDrop';
import { useAppDialog } from '@/contexts/AppDialogContext';

interface ExpenseDetailProps {
  date: string;
  expenses: Expense[];
  onExpenseUpdate?: (
    expenseId: string,
    data: { amount?: number; memo?: string; category?: string; merchant?: string; date?: string }
  ) => void;
  onSaveMerchantRule?: (merchantName: string, category: string) => void;
  onDelete?: (expenseId: string) => void;
  onAddExpense?: () => void;
  onSplitExpense?: (expense: Expense, splits: SplitItem[]) => void;
  onMergeExpenses?: (targetExpense: Expense, sourceExpense: Expense) => void;
  onUnmergeExpense?: (expense: Expense) => void;
  autoEditExpenseId?: string | null;
  onAutoEditHandled?: () => void;
  transactionType: TransactionType;
}

export default function ExpenseDetail({
  date,
  expenses,
  onExpenseUpdate,
  onSaveMerchantRule,
  onDelete,
  onAddExpense,
  onSplitExpense,
  onMergeExpenses,
  onUnmergeExpense,
  autoEditExpenseId,
  onAutoEditHandled,
  transactionType,
}: ExpenseDetailProps) {
  const { showAlert } = useAppDialog();
  const transactionLabel = transactionType === 'income' ? '수입' : '지출';
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [splittingExpenseId, setSplittingExpenseId] = useState<string | null>(null);
  const {
    draggingExpenseId,
    setDraggingExpenseId,
    dragOverExpenseId,
    setDragOverExpenseId,
    findItemAtPosition,
    handleTouchDragEnd,
    registerItemRef,
  } = useDragAndDrop({ expenses, onMergeExpenses });
  const editingExpense = expenses.find((expense) => expense.id === editingExpenseId);
  const splittingExpense = expenses.find((expense) => expense.id === splittingExpenseId);

  useEffect(() => {
    if (!autoEditExpenseId || editingExpenseId === autoEditExpenseId) {
      return;
    }

    const autoEditExpense = expenses.find((expense) => expense.id === autoEditExpenseId);
    if (!autoEditExpense) {
      return;
    }

    setSplittingExpenseId(null);
    setEditingExpenseId(autoEditExpense.id);
    onAutoEditHandled?.();
  }, [autoEditExpenseId, editingExpenseId, expenses, onAutoEditHandled]);

  useEffect(() => {
    if (editingExpenseId && !editingExpense) {
      setEditingExpenseId(null);
    }
    if (splittingExpenseId && !splittingExpense) {
      setSplittingExpenseId(null);
    }
  }, [editingExpense, editingExpenseId, splittingExpense, splittingExpenseId]);

  const openExpenseEditor = (expense: Expense) => {
    setSplittingExpenseId(null);
    setEditingExpenseId(expense.id);
  };

  const handleSaveEdit = (
    expense: Expense,
    updates: { amount?: number; memo?: string; category?: string; merchant?: string; date?: string }
  ) => {
    if (onExpenseUpdate && Object.keys(updates).length > 0) {
      onExpenseUpdate(expense.id, updates);
    }
  };

  const handleSplitMonths = async (expense: Expense, months: number) => {
    if (!onDelete) return;
    await runSplitMonthsAction({
      expense,
      months,
      deleteExpense: onDelete,
      alertFn: (message) => void showAlert(message),
    });
  };

  const formatDate = (dateStr: string) => {
    const dateValue = new Date(dateStr);
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return `${dateValue.getMonth() + 1}월 ${dateValue.getDate()}일 (${days[dateValue.getDay()]})`;
  };

  if (expenses.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200/70 bg-white/95 p-6 shadow-sm backdrop-blur-sm">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-800">{formatDate(date)}</h3>
          {onAddExpense && (
            <button
              onClick={onAddExpense}
              className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-blue-50 hover:text-blue-500"
              aria-label={`${transactionLabel} 추가`}
            >
              <Plus className="h-5 w-5" />
            </button>
          )}
        </div>
        <div className="py-8 text-center text-slate-400">{transactionLabel} 내역이 없습니다</div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white/95 p-6 shadow-sm backdrop-blur-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-800">{formatDate(date)}</h3>
        {onAddExpense && (
          <button
            onClick={onAddExpense}
            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-blue-50 hover:text-blue-500"
            aria-label={`${transactionLabel} 추가`}
          >
            <Plus className="h-5 w-5" />
          </button>
        )}
      </div>

      {draggingExpenseId && (
        <div className="mb-2 rounded-lg bg-blue-100 px-3 py-1.5 text-center text-xs text-blue-700">
          다른 항목 위에 놓으면 합쳐집니다
        </div>
      )}

      <div className="space-y-3">
        {expenses.map((expense) => (
          <ExpenseItem
            key={expense.id}
            expense={expense}
            allExpenses={expenses}
            onEdit={openExpenseEditor}
            onMergeExpenses={onMergeExpenses}
            draggingExpenseId={draggingExpenseId}
            setDraggingExpenseId={setDraggingExpenseId}
            dragOverExpenseId={dragOverExpenseId}
            setDragOverExpenseId={setDragOverExpenseId}
            findItemAtPosition={findItemAtPosition}
            handleTouchDragEnd={handleTouchDragEnd}
            registerItemRef={registerItemRef}
            transactionType={transactionType}
          />
        ))}
      </div>

      {editingExpense && (
        <ExpenseEditModal
          expense={editingExpense}
          isOpen
          onClose={() => setEditingExpenseId(null)}
          transactionType={transactionType}
          onSave={(updates) => handleSaveEdit(editingExpense, updates)}
          onSaveMerchantRule={onSaveMerchantRule}
          onUnmerge={
            onUnmergeExpense ? () => onUnmergeExpense(editingExpense) : undefined
          }
          onOpenSplit={
            transactionType === 'expense' && onSplitExpense
              ? () => {
                  setEditingExpenseId(null);
                  setSplittingExpenseId(editingExpense.id);
                }
              : undefined
          }
          onSplitMonths={
            transactionType === 'expense' && onDelete
              ? (months) => handleSplitMonths(editingExpense, months)
              : undefined
          }
          onCancelSplitGroup={
            transactionType === 'expense' && editingExpense.splitGroupId
              ? () =>
                  runCancelSplitGroupAction({
                    expense: editingExpense,
                    alertFn: (message) => void showAlert(message),
                  })
              : undefined
          }
          onUpdateSplitGroup={
            transactionType === 'expense' && editingExpense.splitGroupId
              ? (newMonths) =>
                  runUpdateSplitGroupAction({
                    expense: editingExpense,
                    newMonths,
                    alertFn: (message) => void showAlert(message),
                  })
              : undefined
          }
          onDelete={onDelete ? () => onDelete(editingExpense.id) : undefined}
          onNotifyPartner={
            transactionType === 'expense'
              ? async () => {
                  const { notifyPartner } = await import('@/lib/partnerNotificationService');
                  await notifyPartner(editingExpense.id, editingExpense.aggregateVersion);
                }
              : undefined
          }
        />
      )}

      {splittingExpense && (
        <ExpenseSplitModal
          expense={splittingExpense}
          isOpen
          onClose={() => setSplittingExpenseId(null)}
          onSave={(splits) => onSplitExpense?.(splittingExpense, splits)}
        />
      )}
    </div>
  );
}
