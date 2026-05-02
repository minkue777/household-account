'use client';

import { X } from 'lucide-react';
import { Expense, Category } from '@/types/expense';
import { useCategoryContext } from '@/contexts/CategoryContext';

interface CategoryExpenseModalProps {
  category: Category;
  expenses: Expense[];
  onClose: () => void;
  onExpenseClick: (expense: Expense) => void;
}

export default function CategoryExpenseModal({
  category,
  expenses,
  onClose,
  onExpenseClick,
}: CategoryExpenseModalProps) {
  const { getCategoryLabel, getCategoryColor } = useCategoryContext();

  return (
    <div
      className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm flex items-center justify-center z-50 p-4"
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
              <p className="text-sm text-slate-500">
                {expenses.length}건 · {expenses.reduce((sum, e) => sum + e.amount, 0).toLocaleString()}원
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            aria-label="닫기"
          >
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        {/* 지출 내역 리스트 */}
        <div className="overflow-y-auto max-h-[60vh] p-4">
          <div className="space-y-2">
            {expenses.map((expense) => (
              <div
                key={expense.id}
                onClick={() => onExpenseClick(expense)}
                className="flex items-center justify-between p-3 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
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
  );
}
