'use client';

import { useMemo, useState } from 'react';
import { ChevronRight, X } from 'lucide-react';
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
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
  const months = useMemo(() => {
    const groups = new Map<string, { expenses: Expense[]; total: number }>();
    for (const expense of expenses) {
      const month = expense.date.slice(0, 7);
      const group = groups.get(month) ?? { expenses: [], total: 0 };
      group.expenses.push(expense);
      group.total += expense.amount;
      groups.set(month, group);
    }
    return Array.from(groups).sort(([left], [right]) => right.localeCompare(left));
  }, [expenses]);

  return (
    <div
      className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${getCategoryLabel(category)} 지출 내역`}
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

        <div className="overflow-y-auto max-h-[60vh] p-4">
          <div className="space-y-2">
            {months.map(([month, group]) => {
              const [year, monthNumber] = month.split('-');
              const expanded = expandedMonth === month;
              return (
                <div key={month} className="overflow-hidden rounded-xl border border-slate-100">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setExpandedMonth(expanded ? null : month)}
                    className="flex w-full items-center gap-2 bg-slate-50 p-3 text-left hover:bg-slate-100 transition-colors"
                  >
                    <ChevronRight aria-hidden="true" className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                    <span className="font-medium text-slate-800">{year}년 {Number(monthNumber)}월</span>
                    <span className="text-xs text-slate-500">{group.expenses.length}건</span>
                    <span className="ml-auto font-semibold text-slate-800">{group.total.toLocaleString()}원</span>
                  </button>
                  {expanded && <div className="divide-y divide-slate-100">
                    {group.expenses.map(expense => (
                      <button
                        type="button"
                        key={expense.id}
                        onClick={() => onExpenseClick(expense)}
                        className="flex w-full items-center justify-between p-3 text-left hover:bg-slate-50 transition-colors"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium text-slate-800 truncate">{expense.merchant}</span>
                          <span className="block text-xs text-slate-500">
                            {expense.date}{expense.memo && ` · ${expense.memo}`}
                          </span>
                        </span>
                        <span className="ml-3 shrink-0 font-semibold text-slate-800">{expense.amount.toLocaleString()}원</span>
                      </button>
                    ))}
                  </div>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
