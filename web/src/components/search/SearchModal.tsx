'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Expense, TransactionType } from '@/types/expense';
import {
  expenseMatchesSearch,
  searchExpenses,
  subscribeToExpenseProjection,
  SplitItem,
} from '@/lib/expenseService';
import {
  runSplitMonthsAction,
  runCancelSplitGroupAction,
  runUpdateSplitGroupAction,
} from '@/lib/utils/monthlySplitActions';
import { Portal } from '../common';
import { ExpenseEditModal, ExpenseSplitModal } from '../expense';
import SearchResultList from './SearchResultList';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExpenseUpdate?: (
    expenseId: string,
    data: { amount?: number; memo?: string; category?: string; merchant?: string; date?: string }
  ) => Promise<void> | void;
  onDelete?: (expenseId: string) => Promise<void> | void;
  onSplitExpense?: (expense: Expense, splits: SplitItem[]) => void;
  transactionType: TransactionType;
}

export default function SearchModal({
  isOpen,
  onClose,
  onExpenseUpdate,
  onDelete,
  onSplitExpense,
  transactionType,
}: SearchModalProps) {
  const transactionLabel = transactionType === 'income' ? '수입' : '지출';
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<Expense[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [splitExpense, setSplitExpense] = useState<Expense | null>(null);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const projectionRef = useRef<ReturnType<typeof subscribeToExpenseProjection> | null>(null);
  const searchRequestIdRef = useRef(0);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      return;
    }

    setKeyword('');
    setResults([]);
    setSelectedExpense(null);
    setSplitExpense(null);
    setExpandedMonth(null);
  }, [isOpen]);

  const refreshSearch = async () => {
    const projection = projectionRef.current;
    if (!projection || !keyword.trim()) return;
    const requestId = ++searchRequestIdRef.current;
    const searchResults = await searchExpenses(keyword, { transactionType });
    if (
      requestId !== searchRequestIdRef.current
      || projectionRef.current !== projection
    ) return;
    projection.publish(searchResults);
  };

  const handleSaveEdit = async (updates: {
    amount?: number;
    memo?: string;
    category?: string;
    merchant?: string;
    date?: string;
  }) => {
    if (!selectedExpense || !onExpenseUpdate) return;
    await onExpenseUpdate(selectedExpense.id, updates);
    void refreshSearch();
  };

  const handleDelete = async (id: string) => {
    if (!onDelete) return;
    await onDelete(id);
    void refreshSearch();
  };

  const handleSplitExpense = (expense: Expense, splits: SplitItem[]) => {
    if (!onSplitExpense) return;
    onSplitExpense(expense, splits);
    refreshSearch();
  };

  const handleSplitMonths = async (months: number) => {
    if (!selectedExpense || !onDelete) return;
    await runSplitMonthsAction({
      expense: selectedExpense,
      months,
      deleteExpense: onDelete,
      onSuccess: refreshSearch,
    });
  };

  const handleCancelSplitGroup = async () => {
    if (!selectedExpense) return;
    await runCancelSplitGroupAction({
      expense: selectedExpense,
      onSuccess: refreshSearch,
    });
  };

  const handleUpdateSplitGroup = async (newMonths: number) => {
    if (!selectedExpense) return;
    await runUpdateSplitGroupAction({
      expense: selectedExpense,
      newMonths,
      onSuccess: refreshSearch,
    });
  };

  const handleSaveSplitFromModal = (splits: SplitItem[]) => {
    if (!splitExpense) return;
    handleSplitExpense(splitExpense, splits);
    setSplitExpense(null);
  };

  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    if (!keyword.trim()) {
      setIsSearching(false);
      setResults([]);
      setExpandedMonth(null);
      return;
    }

    const projection = subscribeToExpenseProjection(
      setResults,
      (expense) =>
        expense.transactionType === transactionType
        && expenseMatchesSearch(expense, keyword)
    );
    projectionRef.current = projection;

    debounceTimer.current = setTimeout(async () => {
      const requestId = ++searchRequestIdRef.current;
      setIsSearching(true);
      try {
        const searchResults = await searchExpenses(keyword, { transactionType });
        if (
          requestId !== searchRequestIdRef.current
          || projectionRef.current !== projection
        ) return;
        projection.publish(searchResults);
        if (searchResults.length > 0) {
          setExpandedMonth(searchResults[0].date.substring(0, 7));
        } else {
          setExpandedMonth(null);
        }
      } finally {
        if (requestId === searchRequestIdRef.current) {
          setIsSearching(false);
        }
      }
    }, 300);

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      searchRequestIdRef.current += 1;
      if (projectionRef.current === projection) projectionRef.current = null;
      projection.dispose();
    };
  }, [keyword, transactionType]);

  if (!isOpen) return null;

  const searchPlaceholder = transactionType === 'income'
    ? `${transactionLabel}처명이나 메모를 검색해보세요`
    : '지출처명, 메모, 카드명을 검색해보세요';

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[9999] flex items-start justify-center bg-slate-900/30 px-4 pt-12 backdrop-blur-sm md:pt-20"
        onClick={onClose}
      >
        <div
          className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="border-b border-slate-100 p-4">
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <input
                  ref={inputRef}
                  type="text"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder={searchPlaceholder}
                  autoFocus
                  className="w-full rounded-xl bg-slate-100 py-3 pl-10 pr-10 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                {keyword && (
                  <button
                    onClick={() => setKeyword('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 transition-colors hover:bg-slate-200"
                    aria-label="검색어 지우기"
                  >
                    <X className="h-4 w-4 text-slate-400" />
                  </button>
                )}
              </div>
              <button
                onClick={onClose}
                className="rounded-xl p-3 transition-colors hover:bg-slate-100"
                aria-label="닫기"
              >
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <SearchResultList
              keyword={keyword}
              results={results}
              isSearching={isSearching}
              expandedMonth={expandedMonth}
              onExpandedMonthChange={setExpandedMonth}
              onExpenseClick={setSelectedExpense}
              transactionType={transactionType}
            />
          </div>
        </div>
      </div>

      {selectedExpense && (
        <ExpenseEditModal
          expense={selectedExpense}
          isOpen={!!selectedExpense}
          onClose={() => setSelectedExpense(null)}
          onSave={(updates) => {
            void handleSaveEdit(updates);
          }}
          onOpenSplit={
            transactionType === 'expense' && onSplitExpense ? () => setSplitExpense(selectedExpense) : undefined
          }
          onSplitMonths={
            transactionType === 'expense' && onDelete ? (months) => void handleSplitMonths(months) : undefined
          }
          onCancelSplitGroup={
            transactionType === 'expense' && selectedExpense.splitGroupId
              ? () => void handleCancelSplitGroup()
              : undefined
          }
          onUpdateSplitGroup={
            transactionType === 'expense' && selectedExpense.splitGroupId
              ? (newMonths) => void handleUpdateSplitGroup(newMonths)
              : undefined
          }
          onDelete={onDelete ? () => void handleDelete(selectedExpense.id) : undefined}
          transactionType={transactionType}
        />
      )}

      {splitExpense && (
        <ExpenseSplitModal
          expense={splitExpense}
          isOpen={!!splitExpense}
          onClose={() => setSplitExpense(null)}
          onSave={handleSaveSplitFromModal}
        />
      )}
    </Portal>
  );
}
