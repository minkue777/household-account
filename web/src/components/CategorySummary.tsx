'use client';

import { useMemo } from 'react';
import { Expense, Category } from '@/types/expense';
import { useCategoryContext } from '@/contexts/CategoryContext';

interface CategorySummaryProps {
  expenses: Expense[];
}

export default function CategorySummary({ expenses }: CategorySummaryProps) {
  const { getCategoryLabel, getCategoryColor, getCategoryBudget, isLoading } = useCategoryContext();

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

  if (isLoading) {
    return (
      <div className="space-y-2 animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 bg-slate-100 rounded" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {categorySummary.map(({ category, total, count }) => {
        const budget = getCategoryBudget(category);
        const color = getCategoryColor(category);
        const label = getCategoryLabel(category);

        // 예산이 있으면 예산 대비 %, 없으면 전체 대비 % 표시
        const percentage = budget !== null
          ? Math.min((total / budget) * 100, 100)
          : totalAmount > 0
            ? (total / totalAmount) * 100
            : 0;

        const isOverBudget = budget !== null && total > budget;
        const usagePercent = budget !== null ? Math.round((total / budget) * 100) : null;

        return (
          <div key={category} className="group">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="text-sm font-medium text-slate-700">
                  {label}
                </span>
                <span className="text-xs text-slate-400">{count}건</span>
              </div>
              <div className="flex items-center gap-1">
                <span className={`text-sm font-semibold ${isOverBudget ? 'text-red-500' : 'text-slate-800'}`}>
                  {total.toLocaleString()}원
                </span>
                {usagePercent !== null && (
                  <span className={`text-xs font-medium ${isOverBudget ? 'text-red-500' : 'text-slate-500'}`}>
                    ({usagePercent}%)
                  </span>
                )}
              </div>
            </div>
            {/* 프로그레스 바 */}
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${isOverBudget ? 'animate-pulse' : ''}`}
                style={{
                  width: `${percentage}%`,
                  backgroundColor: isOverBudget ? '#EF4444' : color,
                }}
              />
            </div>
            {/* 예산 초과 경고 */}
            {isOverBudget && (
              <div className="flex items-center gap-1 mt-1">
                <svg className="w-3 h-3 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <span className="text-xs text-red-500">
                  예산 초과 {(total - budget).toLocaleString()}원
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
