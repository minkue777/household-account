'use client';

import { Expense } from '@/types/expense';
import { useCategoryContext } from '@/contexts/CategoryContext';

interface MonthlyGroup {
  yearMonth: string;
  label: string;
  expenses: Expense[];
  total: number;
}

interface SearchResultListProps {
  keyword: string;
  results: Expense[];
  isSearching: boolean;
  expandedMonth: string | null;
  onExpandedMonthChange: (month: string | null) => void;
  onExpenseClick: (expense: Expense) => void;
}

export default function SearchResultList({
  keyword,
  results,
  isSearching,
  expandedMonth,
  onExpandedMonthChange,
  onExpenseClick,
}: SearchResultListProps) {
  const { getCategoryLabel, getCategoryColor } = useCategoryContext();

  // 월별 그룹화
  const groupedResults: MonthlyGroup[] = results.reduce((groups, expense) => {
    const yearMonth = expense.date.substring(0, 7);
    const existingGroup = groups.find((g) => g.yearMonth === yearMonth);

    if (existingGroup) {
      existingGroup.expenses.push(expense);
      existingGroup.total += expense.amount;
    } else {
      const [year, month] = yearMonth.split('-');
      groups.push({
        yearMonth,
        label: `${year}년 ${parseInt(month)}월`,
        expenses: [expense],
        total: expense.amount,
      });
    }

    return groups;
  }, [] as MonthlyGroup[]);

  // 총 합계
  const totalAmount = results.reduce((sum, e) => sum + e.amount, 0);

  if (isSearching) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (!keyword.trim()) {
    return (
      <div className="text-center py-12 text-slate-400">
        <svg className="w-12 h-12 mx-auto mb-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <p>가맹점명이나 메모를 검색해보세요</p>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="text-center py-12 text-slate-400">
        <svg className="w-12 h-12 mx-auto mb-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <p>&quot;{keyword}&quot;에 대한 검색 결과가 없습니다</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 검색 요약 */}
      <div className="bg-blue-50 rounded-xl p-4">
        <div className="flex items-center justify-between">
          <span className="text-blue-800 font-medium">
            &quot;{keyword}&quot; 검색 결과
          </span>
          <span className="text-blue-600">
            {results.length}건 · {totalAmount.toLocaleString()}원
          </span>
        </div>
      </div>

      {/* 월별 그룹 */}
      {groupedResults.map((group) => (
        <div key={group.yearMonth} className="border border-slate-200 rounded-xl overflow-hidden">
          {/* 월 헤더 */}
          <button
            onClick={() => onExpandedMonthChange(expandedMonth === group.yearMonth ? null : group.yearMonth)}
            className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100 transition-colors"
          >
            <div className="flex items-center gap-2">
              <svg
                className={`w-4 h-4 text-slate-500 transition-transform ${
                  expandedMonth === group.yearMonth ? 'rotate-90' : ''
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <span className="font-semibold text-slate-800">{group.label}</span>
              <span className="text-sm text-slate-500">{group.expenses.length}건</span>
            </div>
            <span className="font-semibold text-slate-800">
              {group.total.toLocaleString()}원
            </span>
          </button>

          {/* 지출 목록 */}
          {expandedMonth === group.yearMonth && (
            <div className="divide-y divide-slate-100">
              {group.expenses.map((expense) => {
                const categoryColor = getCategoryColor(expense.category);
                return (
                  <div
                    key={expense.id}
                    onClick={() => onExpenseClick(expense)}
                    className="flex items-center justify-between p-3 hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0"
                        style={{ backgroundColor: categoryColor }}
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
                    </div>
                    <div className="font-semibold text-slate-800 flex-shrink-0 ml-3">
                      {expense.amount.toLocaleString()}원
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
