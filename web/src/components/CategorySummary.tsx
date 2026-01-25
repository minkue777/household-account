'use client';

import { useMemo } from 'react';
import { Expense, Category } from '@/types/expense';
import { useCategoryContext } from '@/contexts/CategoryContext';

interface CategorySummaryProps {
  expenses: Expense[];
  onCategoryClick?: (category: Category, categoryExpenses: Expense[]) => void;
  budgetAdjustments?: Record<string, number>;
}

export default function CategorySummary({ expenses, onCategoryClick, budgetAdjustments = {} }: CategorySummaryProps) {
  const { categories, getCategoryLabel, getCategoryColor, getCategoryBudget, isLoading } = useCategoryContext();

  const categorySummary = useMemo(() => {
    const totals = new Map<Category, { total: number; count: number }>();

    expenses.forEach((expense) => {
      const current = totals.get(expense.category) || { total: 0, count: 0 };
      totals.set(expense.category, {
        total: current.total + expense.amount,
        count: current.count + 1,
      });
    });

    // 카테고리 순서대로 정렬 (설정에서 지정한 순서)
    const categoryOrder = new Map(categories.map((c, index) => [c.key, index]));
    return Array.from(totals.entries())
      .map(([category, { total, count }]) => ({ category, total, count }))
      .sort((a, b) => {
        const orderA = categoryOrder.get(a.category) ?? 999;
        const orderB = categoryOrder.get(b.category) ?? 999;
        return orderA - orderB;
      });
  }, [expenses, categories]);

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
        const originalBudget = getCategoryBudget(category);
        const adjustment = budgetAdjustments[category] || 0;
        const budget = originalBudget !== null ? originalBudget + adjustment : null;
        const color = getCategoryColor(category);
        const label = getCategoryLabel(category);
        const hasBudget = budget !== null && budget > 0;
        const hasAdjustment = adjustment !== 0;

        // 예산이 있을 때만 퍼센트 계산
        const percentage = hasBudget ? Math.min((total / budget) * 100, 100) : 0;
        const isOverBudget = hasBudget && total > budget;

        // 해당 카테고리의 지출 목록
        const categoryExpenses = expenses.filter(e => e.category === category);

        return (
          <div
            key={category}
            className={`group ${onCategoryClick ? 'cursor-pointer hover:bg-slate-50 -mx-2 px-2 py-1 rounded-lg transition-colors' : ''}`}
            onClick={() => onCategoryClick?.(category, categoryExpenses)}
          >
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="text-sm font-medium text-slate-700">
                  {label}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className={`text-sm font-semibold ${isOverBudget ? 'text-red-500' : 'text-slate-800'}`}>
                  {total.toLocaleString()}원
                </span>
                {hasAdjustment && (
                  <span className={`text-xs ${adjustment > 0 ? 'text-green-500' : 'text-orange-500'}`}>
                    {adjustment > 0 ? '↑' : '↓'}
                  </span>
                )}
                <span className={`text-xs font-medium min-w-[40px] text-right ${isOverBudget ? 'text-red-500' : 'text-slate-500'}`}>
                  {hasBudget ? `(${Math.round((total / budget) * 100)}%)` : '(--)'}
                </span>
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
