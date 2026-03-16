'use client';

import { Portal } from '@/components/common';
import { Expense } from '@/types/expense';
import { useCategoryContext } from '@/contexts/CategoryContext';

interface LocalCurrencyModalProps {
  expenses: Expense[];
  currentMonth: number;
  onClose: () => void;
  onExpenseClick: (expense: Expense) => void;
}

export default function LocalCurrencyModal({
  expenses,
  currentMonth,
  onClose,
  onExpenseClick,
}: LocalCurrencyModalProps) {
  const { getCategoryLabel, getCategoryColor } = useCategoryContext();

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/20 p-4 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-slate-100 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                  />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-800">지역화폐 지출내역</h3>
                <div className="text-sm text-slate-500">
                  <p>{currentMonth}월 · {expenses.length}건</p>
                  <p>{expenses.reduce((sum, expense) => sum + expense.amount, 0).toLocaleString()}원</p>
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-2 transition-colors hover:bg-slate-100"
            >
              <svg className="h-5 w-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="max-h-[60vh] overflow-y-auto p-4">
            {expenses.length === 0 ? (
              <div className="py-8 text-center text-slate-400">
                이번 달 지역화폐 지출 내역이 없습니다.
              </div>
            ) : (
              <div className="space-y-2">
                {expenses.map((expense) => (
                  <div
                    key={expense.id}
                    className="flex cursor-pointer items-center gap-3 rounded-xl bg-slate-50 p-3 transition-colors hover:bg-slate-100"
                    onClick={() => onExpenseClick(expense)}
                  >
                    <div
                      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-medium text-white"
                      style={{ backgroundColor: getCategoryColor(expense.category) }}
                    >
                      {getCategoryLabel(expense.category).slice(0, 2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-slate-800">
                        {expense.merchant}
                      </div>
                      <div className="text-xs text-slate-500">
                        {expense.date}
                        {expense.memo && ` · ${expense.memo}`}
                      </div>
                    </div>
                    <div className="flex-shrink-0 font-semibold text-slate-800">
                      {expense.amount.toLocaleString()}원
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
