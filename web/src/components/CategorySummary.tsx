'use client';

import { useMemo } from 'react';
import { Expense, Category } from '@/types/expense';
import { useCategoryContext } from '@/contexts/CategoryContext';

interface CategorySummaryProps {
  expenses: Expense[];
  onCategoryClick?: (category: Category, categoryExpenses: Expense[]) => void;
}

export default function CategorySummary({ expenses, onCategoryClick }: CategorySummaryProps) {
  const {
    categories,
    getCategoryLabel,
    getCategoryColor,
    getCategoryBudget,
    isLoading,
  } = useCategoryContext();

  const overallTotal = useMemo(
    () => expenses.reduce((sum, expense) => sum + expense.amount, 0),
    [expenses]
  );

  const categorySummary = useMemo(() => {
    const totals = new Map<Category, { total: number; count: number }>();

    expenses.forEach((expense) => {
      const current = totals.get(expense.category) || { total: 0, count: 0 };
      totals.set(expense.category, {
        total: current.total + expense.amount,
        count: current.count + 1,
      });
    });

    const categoryOrder = new Map(categories.map((category, index) => [category.key, index]));

    return Array.from(totals.entries())
      .map(([category, { total, count }]) => ({ category, total, count }))
      .sort((left, right) => {
        const leftOrder = categoryOrder.get(left.category) ?? 999;
        const rightOrder = categoryOrder.get(right.category) ?? 999;
        return leftOrder - rightOrder;
      });
  }, [expenses, categories]);

  if (isLoading) {
    return (
      <div className="space-y-3 animate-pulse">
        {[1, 2, 3].map((index) => (
          <div key={index} className="h-24 rounded-2xl bg-slate-100" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {categorySummary.map(({ category, total, count }) => {
        const budget = getCategoryBudget(category);
        const color = getCategoryColor(category);
        const label = getCategoryLabel(category);
        const hasBudget = budget !== null && budget > 0;
        const percentage = hasBudget ? Math.min((total / budget) * 100, 100) : 0;
        const isOverBudget = hasBudget && total > budget;
        const share = overallTotal > 0 ? Math.round((total / overallTotal) * 100) : 0;
        const categoryExpenses = expenses.filter((expense) => expense.category === category);

        return (
          <div
            key={category}
            className={`rounded-2xl border border-slate-100 bg-slate-50/80 p-3 transition-all ${
              onCategoryClick
                ? 'cursor-pointer hover:border-slate-200 hover:bg-white hover:shadow-sm'
                : ''
            }`}
            onClick={() => onCategoryClick?.(category, categoryExpenses)}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex items-start gap-3">
                <span
                  className="mt-1 h-3 w-3 flex-shrink-0 rounded-full ring-4 ring-white"
                  style={{ backgroundColor: color }}
                />

                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-800">
                    {label}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    <span>{count}건</span>
                    <span className="h-1 w-1 rounded-full bg-slate-300" />
                    <span>{share}% 비중</span>
                    {hasBudget && (
                      <>
                        <span className="h-1 w-1 rounded-full bg-slate-300" />
                        <span>예산 {budget.toLocaleString()}원</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="text-right">
                <div className={`text-sm font-bold ${isOverBudget ? 'text-red-500' : 'text-slate-900'}`}>
                  {total.toLocaleString()}원
                </div>
                <div className={`mt-1 text-[11px] ${isOverBudget ? 'text-red-500' : 'text-slate-400'}`}>
                  {hasBudget ? `예산 대비 ${Math.round((total / budget) * 100)}%` : '예산 미설정'}
                </div>
              </div>
            </div>

            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
              <div
                className={`h-full rounded-full transition-all duration-300 ${isOverBudget ? 'animate-pulse' : ''}`}
                style={{
                  width: `${percentage}%`,
                  backgroundColor: isOverBudget ? '#ef4444' : color,
                }}
              />
            </div>

            <div className="mt-2 flex items-center justify-between text-[11px]">
              {hasBudget ? (
                <>
                  <span className={isOverBudget ? 'text-red-500' : 'text-slate-500'}>
                    {isOverBudget
                      ? `예산 초과 ${(total - budget).toLocaleString()}원`
                      : `예산까지 ${(budget - total).toLocaleString()}원 남음`}
                  </span>
                  <span className={isOverBudget ? 'text-red-500' : 'text-slate-400'}>
                    {Math.round((total / budget) * 100)}%
                  </span>
                </>
              ) : (
                <>
                  <span className="text-slate-500">예산을 설정하면 진행률이 표시됩니다.</span>
                  <span className="text-slate-400">{share}%</span>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
