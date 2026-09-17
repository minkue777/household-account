'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { Expense, TransactionType } from '@/types/expense';
import type { SplitItem } from '@/lib/expenseService';
import {
  runSplitMonthsAction,
  runCancelSplitGroupAction,
  runUpdateSplitGroupAction,
} from '@/lib/utils/monthlySplitActions';
import Portal from '../common/Portal';
import { ExpenseEditModal, ExpenseSplitModal } from '../expense';
import { useExpenseEditor } from '../expense/hooks/useExpenseEditor';
import SearchResultList from './SearchResultList';
import { useAppDialog } from '@/contexts/AppDialogContext';
import { useHousehold } from '@/contexts/HouseholdContext';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExpenseUpdate?: (
    expenseId: string,
    data: { amount?: number; memo?: string; category?: string; merchant?: string; date?: string },
    expectedVersion?: number
  ) => Promise<void> | void;
  onDelete?: (expenseId: string, expectedVersion?: number) => Promise<void> | void;
  onSplitExpense?: (
    expense: Expense,
    splits: SplitItem[]
  ) => Promise<void> | void;
  transactionType: TransactionType;
}

type ExpenseProjectionSubscription = ReturnType<
  (typeof import('@/lib/expenseService'))['subscribeToExpenseProjection']
>;

interface ExpenseSearchSession {
  sourceWindow: string;
  refresh?: () => Promise<void>;
}

export default function SearchModal({
  isOpen,
  onClose,
  onExpenseUpdate,
  onDelete,
  onSplitExpense,
  transactionType,
}: SearchModalProps) {
  const { showAlert } = useAppDialog();
  const { householdKey, remoteReadEpoch } = useHousehold();
  const transactionLabel = transactionType === 'income' ? '수입' : '지출';
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<Expense[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const searchSessionRef = useRef<ExpenseSearchSession | null>(null);
  const { expense: selectedExpense, selectExpense: setSelectedExpense, editorKey } = useExpenseEditor();
  const [splitExpense, setSplitExpense] = useState<Expense | null>(null);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsContainerRef = useRef<HTMLDivElement>(null);
  const refreshScrollTopRef = useRef<number | null>(null);
  const projectionRef = useRef<ExpenseProjectionSubscription | null>(null);
  const searchRequestIdRef = useRef(0);

  useLayoutEffect(() => {
    if (refreshScrollTopRef.current !== null && resultsContainerRef.current) {
      resultsContainerRef.current.scrollTop = refreshScrollTopRef.current;
      refreshScrollTopRef.current = null;
    }
  }, [results]);

  useEffect(() => {
    if (!isOpen) return;
    const session: ExpenseSearchSession = { sourceWindow: `search-${Date.now()}-${Math.random()}` };
    searchSessionRef.current = session;
    void import('@/lib/expenseService').then(async service => {
      if (searchSessionRef.current === session) await service.prepareExpenseSearchWindow(session.sourceWindow);
    }).catch(() => { /* The actual search reports a preparation failure. */ });
    return () => {
      if (searchSessionRef.current === session) searchSessionRef.current = null;
      const closingWindowId = session.sourceWindow;
      void import('@/lib/expenseService').then(service => service.closeExpenseSearchWindow?.(closingWindowId));
    };
  }, [isOpen, householdKey, remoteReadEpoch]);

  useEffect(() => {
    setResults([]);
    setSelectedExpense(null);
    setSplitExpense(null);
  }, [householdKey, remoteReadEpoch, setSelectedExpense]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
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
  }, [isOpen, setSelectedExpense]);

  const refreshSearch = async (session: ExpenseSearchSession | null) => {
    if (!session || searchSessionRef.current !== session) return;
    const { closeExpenseSearchWindow } = await import('@/lib/expenseService');
    if (searchSessionRef.current !== session) return;
    // A completed mutation invalidates the source even if the user changed or cleared the query.
    closeExpenseSearchWindow(session.sourceWindow);
    session.sourceWindow = `search-${Date.now()}-${Math.random()}`;
    await session.refresh?.();
  };

  const handleSaveEdit = async (updates: {
    amount?: number;
    memo?: string;
    category?: string;
    merchant?: string;
    date?: string;
  }) => {
    if (!selectedExpense || !onExpenseUpdate) return;
    const session = searchSessionRef.current;
    await onExpenseUpdate(selectedExpense.id, updates, selectedExpense.aggregateVersion);
    void refreshSearch(session);
  };

  const handleDelete = async (id: string) => {
    if (!onDelete) return;
    const expense = results.find(item => item.id === id) ?? selectedExpense;
    if (!expense || expense.id !== id) throw new Error('삭제할 거래의 버전을 찾을 수 없습니다.');
    const session = searchSessionRef.current;
    await onDelete(id, expense.aggregateVersion);
    void refreshSearch(session);
  };

  const handleSplitExpense = async (expense: Expense, splits: SplitItem[]) => {
    if (!onSplitExpense) return;
    const session = searchSessionRef.current;
    await onSplitExpense(expense, splits);
    void refreshSearch(session);
  };

  const handleSplitMonths = async (months: number) => {
    if (!selectedExpense || !onDelete) return;
    const session = searchSessionRef.current;
    await runSplitMonthsAction({
      expense: selectedExpense,
      months,
      deleteExpense: onDelete,
      onSuccess: () => refreshSearch(session),
      alertFn: (message) => void showAlert(message),
    });
  };

  const handleCancelSplitGroup = async () => {
    if (!selectedExpense) return;
    const session = searchSessionRef.current;
    await runCancelSplitGroupAction({
      expense: selectedExpense,
      onSuccess: () => refreshSearch(session),
      alertFn: (message) => void showAlert(message),
    });
  };

  const handleUpdateSplitGroup = async (newMonths: number) => {
    if (!selectedExpense) return;
    const session = searchSessionRef.current;
    await runUpdateSplitGroupAction({
      expense: selectedExpense,
      newMonths,
      onSuccess: () => refreshSearch(session),
      alertFn: (message) => void showAlert(message),
    });
  };

  const handleSaveSplitFromModal = (splits: SplitItem[]): Promise<void> | void => {
    if (!splitExpense) return;
    return handleSplitExpense(splitExpense, splits);
  };

  useEffect(() => {
    setResults([]);
    refreshScrollTopRef.current = null;
    setSearchError('');
    const session = searchSessionRef.current;
    if (!isOpen || !keyword.trim() || !session) {
      setIsSearching(false);
      setResults([]);
      setExpandedMonth(null);
      return;
    }

    let cancelled = false;
    let projection: ExpenseProjectionSubscription | undefined;
    let refresh: (() => Promise<void>) | undefined;
    void import('@/lib/expenseService').then(({
      createExpenseSearchMatcher,
      searchExpenses,
      subscribeToExpenseProjection,
    }) => {
      if (cancelled) return;
      const matchesSearch = createExpenseSearchMatcher(keyword);
      const currentProjection = subscribeToExpenseProjection(
        setResults,
        (expense) =>
          expense.transactionType === transactionType
          && matchesSearch(expense)
      );
      projection = currentProjection;
      projectionRef.current = currentProjection;

      const runSearch = async (preserveView: boolean) => {
        const requestId = ++searchRequestIdRef.current;
        const isCurrentRequest = () => !cancelled
          && searchSessionRef.current === session
          && requestId === searchRequestIdRef.current
          && projectionRef.current === projection;
        setIsSearching(true);
        setSearchError('');
        try {
          const searchResults = await searchExpenses(keyword, { transactionType, sourceWindow: session.sourceWindow });
          if (!isCurrentRequest()) return;
          if (preserveView) refreshScrollTopRef.current = resultsContainerRef.current?.scrollTop ?? null;
          currentProjection.publish(searchResults);
          if (preserveView) {
            setExpandedMonth(currentMonth => currentMonth === null
              || searchResults.some(expense => expense.date.substring(0, 7) === currentMonth)
              ? currentMonth : null);
          } else {
            setExpandedMonth(searchResults[0]?.date.substring(0, 7) ?? null);
          }
        } catch (error) {
          if (isCurrentRequest()) {
            setSearchError(error instanceof Error ? error.message : '검색 결과를 불러오지 못했습니다.');
          }
        } finally {
          if (isCurrentRequest()) {
            setIsSearching(false);
          }
        }
      };
      refresh = () => runSearch(true);
      session.refresh = refresh;
      void runSearch(false);
    });

    return () => {
      cancelled = true;
      searchRequestIdRef.current += 1;
      if (session.refresh === refresh) session.refresh = undefined;
      if (projectionRef.current === projection) projectionRef.current = null;
      projection?.dispose();
    };
  }, [keyword, transactionType, isOpen, householdKey, remoteReadEpoch]);

  if (!isOpen) return null;

  const searchPlaceholder = transactionType === 'income'
    ? `${transactionLabel}처명이나 메모를 검색해보세요`
    : '지출처명, 메모, 카드명을 검색해보세요';

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[9999] flex items-start justify-center px-4 pt-12 md:pt-20"
        onClick={onClose}
      >
        {/* Keep changing search results outside the backdrop-filter element. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-slate-900/30 backdrop-blur-[2px]" />
        <div
          className="relative flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
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

          <div ref={resultsContainerRef} className="flex-1 overflow-y-auto p-4" aria-busy={isSearching}>
            {(!searchError || results.length > 0) && <SearchResultList
              keyword={keyword}
              results={results}
              isSearching={isSearching}
              expandedMonth={expandedMonth}
              onExpandedMonthChange={setExpandedMonth}
              onExpenseClick={setSelectedExpense}
              transactionType={transactionType}
            />}
            {searchError && <p role="alert" className="py-2 text-sm text-red-600">{searchError}</p>}
          </div>
        </div>
      </div>

      {selectedExpense && (
        <ExpenseEditModal
          key={editorKey}
          expense={selectedExpense}
          isOpen={!!selectedExpense}
          onClose={() => setSelectedExpense(null)}
          onSave={handleSaveEdit}
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
          onRestoreItemSplit={selectedExpense.derivedFromTransactionId ? async () => {
            const session = searchSessionRef.current;
            const { restoreItemSplit } = await import('@/lib/expenseService');
            await restoreItemSplit(selectedExpense);
            await refreshSearch(session);
          } : undefined}
          onUpdateSplitGroup={
            transactionType === 'expense' && selectedExpense.splitGroupId
              ? (newMonths) => void handleUpdateSplitGroup(newMonths)
              : undefined
          }
          onDelete={onDelete ? () => handleDelete(selectedExpense.id) : undefined}
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
