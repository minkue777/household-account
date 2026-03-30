'use client';

import { Portal } from '@/components/common';
import { Expense, Category, TransactionType } from '@/types/expense';
import { useCategoryContext } from '@/contexts/CategoryContext';

interface CategoryDetailModalProps {
  category: Category;
  expenses: Expense[];
  currentMonth: number;
  onClose: () => void;
  transactionType: TransactionType;
}

export default function CategoryDetailModal({
  category,
  expenses,
  currentMonth,
  onClose,
  transactionType,
}: CategoryDetailModalProps) {
  const { getCategoryLabel, getCategoryColor, getCategoryBudget } = useCategoryContext();
  const showBudget = transactionType === 'expense';
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const budget = getCategoryBudget(category);
  const hasBudget = showBudget && budget !== null && budget > 0;
  const percentage = hasBudget ? Math.round((total / budget) * 100) : 0;
  const isOverBudget = hasBudget && total > budget;

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/20 p-4 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-slate-100 p-4">
            <div className="flex items-center gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-medium text-white"
                style={{ backgroundColor: getCategoryColor(category) }}
              >
                {getCategoryLabel(category).slice(0, 2)}
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-800">{getCategoryLabel(category)}</h3>
                <div className="text-sm text-slate-500">
                  <p>
                    {currentMonth}월 · {expenses.length}건
                  </p>
                  <p className={isOverBudget ? 'font-medium text-red-500' : ''}>
                    {total.toLocaleString()}원
                    {hasBudget ? ` / ${budget.toLocaleString()}원 (${percentage}%)` : ''}
                  </p>
                </div>
              </div>
            </div>
            <button onClick={onClose} className="rounded-lg p-2 transition-colors hover:bg-slate-100">
              <svg className="h-5 w-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="max-h-[60vh] overflow-y-auto p-4">
            <div className="space-y-2">
              {expenses.map((expense) => (
                <div key={expense.id} className="flex items-center justify-between rounded-xl bg-slate-50 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-slate-800">{expense.merchant}</div>
                    <div className="text-xs text-slate-500">
                      {expense.date}
                      {expense.memo ? ` · ${expense.memo}` : ''}
                    </div>
                  </div>
                  <div className="ml-3 flex-shrink-0 font-semibold text-slate-800">
                    {expense.amount.toLocaleString()}원
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}
