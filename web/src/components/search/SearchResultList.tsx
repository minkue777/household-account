'use client';

import { ChevronRight, Search } from 'lucide-react';
import { Expense, TransactionType } from '@/types/expense';
import { useCategoryContext } from '@/contexts/CategoryContext';
import { getLedgerPrimaryText, getLedgerSecondaryText } from '@/lib/utils/ledgerDisplay';

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
  transactionType: TransactionType;
}

export default function SearchResultList({
  keyword,
  results,
  isSearching,
  expandedMonth,
  onExpandedMonthChange,
  onExpenseClick,
  transactionType,
}: SearchResultListProps) {
  const { getCategoryLabel, getCategoryColor } = useCategoryContext();
  const transactionLabel = transactionType === 'income' ? '수입' : '지출';

  const groupedResults: MonthlyGroup[] = results.reduce((groups, expense) => {
    const yearMonth = expense.date.substring(0, 7);
    const existingGroup = groups.find((group) => group.yearMonth === yearMonth);

    if (existingGroup) {
      existingGroup.expenses.push(expense);
      existingGroup.total += expense.amount;
      return groups;
    }

    const [year, month] = yearMonth.split('-');
    groups.push({
      yearMonth,
      label: `${year}년 ${Number.parseInt(month, 10)}월`,
      expenses: [expense],
      total: expense.amount,
    });

    return groups;
  }, [] as MonthlyGroup[]);

  const totalAmount = results.reduce((sum, expense) => sum + expense.amount, 0);

  if (isSearching) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-500" />
      </div>
    );
  }

  if (!keyword.trim()) {
    return (
      <div className="py-12 text-center text-slate-400">
        <Search className="mx-auto mb-3 h-12 w-12 text-slate-300" />
        <p>{transactionLabel}처명이나 메모를 검색해보세요.</p>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="py-12 text-center text-slate-400">
        <Search className="mx-auto mb-3 h-12 w-12 text-slate-300" />
        <p>&quot;{keyword}&quot;에 대한 검색 결과가 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-blue-50 p-4">
        <div className="flex items-center justify-between">
          <span className="font-medium text-blue-800">&quot;{keyword}&quot; 검색 결과</span>
          <span className="text-blue-600">
            {results.length}건 · {totalAmount.toLocaleString()}원
          </span>
        </div>
      </div>

      {groupedResults.map((group) => (
        <div key={group.yearMonth} className="overflow-hidden rounded-xl border border-slate-200">
          <button
            onClick={() =>
              onExpandedMonthChange(expandedMonth === group.yearMonth ? null : group.yearMonth)
            }
            className="flex w-full items-center justify-between bg-slate-50 p-4 transition-colors hover:bg-slate-100"
          >
            <div className="flex items-center gap-2">
              <ChevronRight
                className={`h-4 w-4 text-slate-500 transition-transform ${
                  expandedMonth === group.yearMonth ? 'rotate-90' : ''
                }`}
              />
              <span className="font-semibold text-slate-800">{group.label}</span>
              <span className="text-sm text-slate-500">{group.expenses.length}건</span>
            </div>
            <span className="font-semibold text-slate-800">{group.total.toLocaleString()}원</span>
          </button>

          {expandedMonth === group.yearMonth && (
            <div className="divide-y divide-slate-100">
              {group.expenses.map((expense) => {
                const categoryColor = getCategoryColor(expense.category);
                const primaryText = getLedgerPrimaryText(expense, transactionType);
                const secondaryText = getLedgerSecondaryText(expense, transactionType);
                return (
                  <div
                    key={expense.id}
                    onClick={() => onExpenseClick(expense)}
                    className="flex cursor-pointer items-center justify-between p-3 transition-colors hover:bg-slate-50"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div
                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-medium text-white"
                        style={{ backgroundColor: transactionType === 'income' ? '#10B981' : categoryColor }}
                      >
                        {transactionType === 'income' ? '수입' : getCategoryLabel(expense.category).slice(0, 2)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-slate-800">{primaryText}</div>
                        <div className="text-xs text-slate-500">
                          {expense.date}
                          {secondaryText ? ` · ${secondaryText}` : ''}
                        </div>
                      </div>
                    </div>
                    <div className="ml-3 flex-shrink-0 font-semibold text-slate-800">
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
