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
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-blue-100 text-blue-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-800">
                  경기지역화폐
                </h3>
                <div className="text-sm text-slate-500">
                  <p>{currentMonth}월 · {expenses.length}건</p>
                  <p>{expenses.reduce((sum, e) => sum + e.amount, 0).toLocaleString()}원</p>
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
            {expenses.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                이번 달 경기지역화폐 지출 내역이 없습니다.
              </div>
            ) : (
              <div className="space-y-2">
                {expenses.map((expense) => (
                  <div
                    key={expense.id}
                    className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl cursor-pointer hover:bg-slate-100 transition-colors"
                    onClick={() => onExpenseClick(expense)}
                  >
                    {/* 카테고리 뱃지 */}
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0"
                      style={{ backgroundColor: getCategoryColor(expense.category) }}
                    >
                      {getCategoryLabel(expense.category).slice(0, 2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-800 truncate">
                        {expense.merchant}
                      </div>
                      <div className="text-xs text-slate-500">
                        {expense.date}
                        {expense.memo && ` · ${expense.memo}`}
                      </div>
                    </div>
                    <div className="font-semibold text-slate-800 flex-shrink-0">
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
