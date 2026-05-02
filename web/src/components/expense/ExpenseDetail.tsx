'use client';

import { Plus } from 'lucide-react';
import { Expense, TransactionType } from '@/types/expense';
import { SplitItem } from '@/lib/expenseService';
import ExpenseItem from './ExpenseItem';
import { useDragAndDrop } from './hooks/useDragAndDrop';

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
  const transactionLabel = transactionType === 'income' ? '수입' : '지출';
  const {
    draggingExpenseId,
    setDraggingExpenseId,
    dragOverExpenseId,
    setDragOverExpenseId,
    findItemAtPosition,
    handleTouchDragEnd,
    registerItemRef,
  } = useDragAndDrop({ expenses, onMergeExpenses });

  const formatDate = (dateStr: string) => {
    const dateValue = new Date(dateStr);
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return `${dateValue.getMonth() + 1}월 ${dateValue.getDate()}일 (${days[dateValue.getDay()]})`;
  };

  if (expenses.length === 0) {
    return (
      <div className="animate-slideDown rounded-2xl border border-slate-200/70 bg-white/95 p-6 shadow-sm backdrop-blur-sm">
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
    <div className="animate-slideDown rounded-2xl border border-slate-200/70 bg-white/95 p-6 shadow-sm backdrop-blur-sm">
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
            onExpenseUpdate={onExpenseUpdate}
            onSaveMerchantRule={onSaveMerchantRule}
            onDelete={onDelete}
            onSplitExpense={onSplitExpense}
            onMergeExpenses={onMergeExpenses}
            onUnmergeExpense={onUnmergeExpense}
            draggingExpenseId={draggingExpenseId}
            setDraggingExpenseId={setDraggingExpenseId}
            dragOverExpenseId={dragOverExpenseId}
            setDragOverExpenseId={setDragOverExpenseId}
            findItemAtPosition={findItemAtPosition}
            handleTouchDragEnd={handleTouchDragEnd}
            registerItemRef={registerItemRef}
            autoEdit={autoEditExpenseId === expense.id}
            onAutoEditHandled={onAutoEditHandled}
            transactionType={transactionType}
          />
        ))}
      </div>
    </div>
  );
}
