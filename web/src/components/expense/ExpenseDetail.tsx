'use client';

import { Expense } from '@/types/expense';
import { SplitItem } from '@/lib/expenseService';
import ExpenseItem from './ExpenseItem';
import { useDragAndDrop } from './hooks/useDragAndDrop';

interface ExpenseDetailProps {
  date: string;
  expenses: Expense[];
  onExpenseUpdate?: (expenseId: string, data: { amount?: number; memo?: string; category?: string; merchant?: string }) => void;
  onSaveMerchantRule?: (merchantName: string, category: string) => void;
  onDelete?: (expenseId: string) => void;
  onAddExpense?: () => void;
  onSplitExpense?: (expense: Expense, splits: SplitItem[]) => void;
  onMergeExpenses?: (targetExpense: Expense, sourceExpense: Expense) => void;
  onUnmergeExpense?: (expense: Expense) => void;
  autoEditExpenseId?: string | null;
  onAutoEditHandled?: () => void;
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
}: ExpenseDetailProps) {
  const {
    draggingExpenseId,
    setDraggingExpenseId,
    dragOverExpenseId,
    setDragOverExpenseId,
    findItemAtPosition,
    handleTouchDragEnd,
    registerItemRef,
  } = useDragAndDrop({ expenses, onMergeExpenses });

  // 날짜 포맷팅
  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return `${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
  };

  if (expenses.length === 0) {
    return (
      <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-200/70 p-6 animate-slideDown">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-800">
            {formatDate(date)}
          </h3>
          {onAddExpense && (
            <button
              onClick={onAddExpense}
              className="p-2 text-slate-500 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          )}
        </div>
        <div className="text-center py-8 text-slate-400">
          지출 내역이 없습니다
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-200/70 p-6 animate-slideDown">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-slate-800">
          {formatDate(date)}
        </h3>
        {onAddExpense && (
          <button
            onClick={onAddExpense}
            className="p-2 text-slate-500 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        )}
      </div>

      {draggingExpenseId && (
        <div className="mb-2 px-3 py-1.5 bg-blue-100 text-blue-700 text-xs rounded-lg text-center">
          다른 항목 위에 놓으면 합칩니다
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
          />
        ))}
      </div>
    </div>
  );
}
