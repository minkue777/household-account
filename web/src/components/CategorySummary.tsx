'use client';

import { useMemo } from 'react';
import { Expense, Category, CATEGORY_LABELS, CATEGORY_COLORS } from '@/types/expense';

interface CategorySummaryProps {
  expenses: Expense[];
}

export default function CategorySummary({ expenses }: CategorySummaryProps) {
  const categorySummary = useMemo(() => {
    const totals = new Map<Category, { total: number; count: number }>();

    expenses.forEach((expense) => {
      const current = totals.get(expense.category) || { total: 0, count: 0 };
      totals.set(expense.category, {
        total: current.total + expense.amount,
        count: current.count + 1,
      });
    });

    // 금액 순으로 정렬
    return Array.from(totals.entries())
      .map(([category, { total, count }]) => ({ category, total, count }))
      .sort((a, b) => b.total - a.total);
  }, [expenses]);

  const totalAmount = expenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="space-y-2">
      {categorySummary.map(({ category, total, count }) => {
        const percentage = totalAmount > 0 ? (total / totalAmount) * 100 : 0;

        return (
          <div key={category} className="group">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: CATEGORY_COLORS[category] }}
                />
                <span className="text-sm font-medium text-slate-700">
                  {CATEGORY_LABELS[category]}
                </span>
                <span className="text-xs text-slate-400">{count}건</span>
              </div>
              <span className="text-sm font-semibold text-slate-800">
                {total.toLocaleString()}원
              </span>
            </div>
            {/* 프로그레스 바 */}
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${percentage}%`,
                  backgroundColor: CATEGORY_COLORS[category],
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
