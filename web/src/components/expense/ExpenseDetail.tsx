'use client';

import { useMemo } from 'react';
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

  const dailyTotal = useMemo(
    () => expenses.reduce((sum, expense) => sum + expense.amount, 0),
    [expenses]
  );

  const formatDate = (dateStr: string) => {
    const targetDate = new Date(dateStr);
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return `${targetDate.getMonth() + 1}월 ${targetDate.getDate()}일 (${days[targetDate.getDay()]})`;
  };

  const headerAction = onAddExpense ? (
    <button
      onClick={onAddExpense}
      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
      </svg>
      <span className="hidden sm:inline">이 날짜에 추가</span>
    </button>
  ) : null;

  if (expenses.length === 0) {
    return (
      <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-200/70 p-6 animate-slideDown">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">
              {formatDate(date)}
            </div>
            <h3 className="mt-3 text-xl font-semibold text-slate-800">
              등록된 지출이 없습니다
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              이 날짜의 소비를 직접 추가해보실 수 있습니다.
            </p>
          </div>
          {headerAction}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-200/70 p-6 animate-slideDown">
      <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">
            {formatDate(date)}
          </div>

          <div className="mt-3 flex items-end gap-2">
            <span className="text-3xl font-bold tracking-tight text-slate-900">
              {dailyTotal.toLocaleString()}
            </span>
            <span className="pb-1 text-sm font-medium text-slate-400">원</span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
              {expenses.length}건의 지출
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
              상세 수정 가능
            </span>
          </div>
        </div>

        {headerAction}
      </div>

      {draggingExpenseId && (
        <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700">
          다른 항목 위에 놓으면 하나로 합쳐집니다.
        </div>
      )}

      <div className="mt-5 space-y-3">
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
