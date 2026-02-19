'use client';

import { Portal } from '@/components/common';
import { Expense, Category } from '@/types/expense';
import { useCategoryContext } from '@/contexts/CategoryContext';

interface CategoryDetailModalProps {
  category: Category;
  expenses: Expense[];
  currentMonth: number;
  onClose: () => void;
}

export default function CategoryDetailModal({
  category,
  expenses,
  currentMonth,
  onClose,
}: CategoryDetailModalProps) {
  const { getCategoryLabel, getCategoryColor, getCategoryBudget } = useCategoryContext();

  const total = expenses.reduce((sum, e) => sum + e.amount, 0);
  const budget = getCategoryBudget(category);
  const hasBudget = budget !== null && budget > 0;
  const percentage = hasBudget ? Math.round((total / budget) * 100) : 0;
  const isOverBudget = hasBudget && total > budget;

  return (
    <Portal>
      <div
        className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm flex items-center justify-center z-[9999] p-4"
        onClick={onClose}
      >
        <div
          className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 모달 헤더 */}
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-medium"
                style={{ backgroundColor: getCategoryColor(category) }}
              >
                {getCategoryLabel(category).slice(0, 2)}
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-800">
                  {getCategoryLabel(category)}
                </h3>
                <div className="text-sm text-slate-500">
                  <p>{currentMonth}월 · {expenses.length}건</p>
                  <p className={isOverBudget ? 'text-red-500 font-medium' : ''}>
                    {total.toLocaleString()}
                    {hasBudget ? ` / ${budget.toLocaleString()}원 (${percentage}%)` : '원'}
                  </p>
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* 지출 내역 리스트 */}
          <div className="overflow-y-auto max-h-[60vh] p-4">
            <div className="space-y-2">
              {expenses.map((expense) => (
                <div
                  key={expense.id}
                  className="flex items-center justify-between p-3 bg-slate-50 rounded-xl"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-slate-800 truncate">
                      {expense.merchant}
                    </div>
                    <div className="text-xs text-slate-500">
                      {expense.date}
                      {expense.memo && ` · ${expense.memo}`}
                    </div>
                  </div>
                  <div className="font-semibold text-slate-800 flex-shrink-0 ml-3">
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
