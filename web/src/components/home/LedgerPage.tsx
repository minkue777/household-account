'use client';

import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Calendar from '@/components/Calendar';
import CategorySummary from '@/components/CategorySummary';
import CategoryDetailModal from '@/components/CategoryDetailModal';
import LocalCurrencyModal from '@/components/LocalCurrencyModal';
import { Expense, Category, TransactionType } from '@/types/expense';
import { DEFAULT_HOME_SUMMARY_CONFIG } from '@/types/household';
import BalanceCards from '@/components/BalanceCards';
import HomeHeader from '@/components/HomeHeader';
import AddExpenseModal from '@/components/expense/AddExpenseModal';
import ExpenseDetail from '@/components/expense/ExpenseDetail';
import IncomeSummaryModal from '@/components/expense/IncomeSummaryModal';
import SearchModal from '@/components/search/SearchModal';
import type { SplitItem } from '@/lib/expenseService';
import { orderLedgerTransactions } from '@/features/ledger/domain/ledgerTransactionOrder';
import { useHousehold } from '@/contexts/HouseholdContext';
import { useCategoryContext } from '@/contexts/CategoryContext';
import { useLedgerReadModel } from '@/contexts/LedgerReadModelContext';
import {
  markWebFirstHomeCompletePaint,
  markWebFirstLedgerPaint,
  markWebLedgerCacheResult,
} from '@/platform/performance/webStartupPerformance';
interface LedgerPageProps {
  transactionType: TransactionType;
}

export default function LedgerPage({ transactionType }: LedgerPageProps) {
  const isIncome = transactionType === 'income';
  const transactionLabel = isIncome ? '수입' : '지출';
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const {
    household,
    householdKey,
    isSessionVerified = true,
  } = useHousehold();
  const {
    isLoading: categoriesLoading,
    serverSnapshotReady: categoriesServerSnapshotReady,
  } = useCategoryContext();

  const [currentYear, setCurrentYear] = useState(() => new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(() => new Date().getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [yearlyExpenses, setYearlyExpenses] = useState<Expense[]>([]);
  const [yearlyTotal, setYearlyTotal] = useState<number | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [editExpenseId, setEditExpenseId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [showLocalCurrencyModal, setShowLocalCurrencyModal] = useState(false);
  const [localCurrencyExpenses, setLocalCurrencyExpenses] = useState<Expense[]>([]);
  const [autoEditExpenseId, setAutoEditExpenseId] = useState<string | null>(null);
  const [incomeSummaryMode, setIncomeSummaryMode] = useState<'monthly' | 'yearly' | null>(null);
  const {
    expenses,
    isLoading,
    serverSnapshotReady,
    readError,
    localCurrencyBalance,
    localCurrencySettled,
    localCurrencyReady,
    readRefreshKey,
    prefetchAdjacentPeriods,
  } = useLedgerReadModel({
    year: currentYear,
    month: currentMonth,
    transactionType,
  });

  const homeSummaryConfig = household?.homeSummaryConfig || DEFAULT_HOME_SUMMARY_CONFIG;
  const needsYearlyTotal =
    isIncome ||
    homeSummaryConfig.leftCard === 'yearlySpent' ||
    homeSummaryConfig.rightCard === 'yearlySpent';

  useEffect(() => {
    if (
      !serverSnapshotReady
      || categoriesLoading
      || !localCurrencySettled
    ) return undefined;

    return prefetchAdjacentPeriods();
  }, [
    categoriesLoading,
    localCurrencySettled,
    prefetchAdjacentPeriods,
    serverSnapshotReady,
  ]);

  useLayoutEffect(() => {
    markWebLedgerCacheResult(false);
  }, [currentYear, currentMonth, transactionType]);

  useLayoutEffect(() => {
    setYearlyExpenses([]);
    setYearlyTotal(null);
  }, [currentYear, transactionType]);

  useEffect(() => {
    if (!serverSnapshotReady) return undefined;

    let firstFrameId: number | undefined;
    let paintFrameId: number | undefined;
    let fallbackId: number | undefined;
    if (typeof window.requestAnimationFrame === 'function') {
      firstFrameId = window.requestAnimationFrame(() => {
        paintFrameId = window.requestAnimationFrame(markWebFirstLedgerPaint);
      });
    } else {
      fallbackId = window.setTimeout(markWebFirstLedgerPaint, 0);
    }

    return () => {
      if (firstFrameId !== undefined) window.cancelAnimationFrame(firstFrameId);
      if (paintFrameId !== undefined) window.cancelAnimationFrame(paintFrameId);
      if (fallbackId !== undefined) window.clearTimeout(fallbackId);
    };
  }, [serverSnapshotReady]);

  useEffect(() => {
    const yearlySummaryReady = !needsYearlyTotal || yearlyTotal !== null;
    if (
      !serverSnapshotReady
      || !categoriesServerSnapshotReady
      || !localCurrencyReady
      || !yearlySummaryReady
    ) {
      return undefined;
    }

    let firstFrameId: number | undefined;
    let paintFrameId: number | undefined;
    let fallbackId: number | undefined;
    if (typeof window.requestAnimationFrame === 'function') {
      firstFrameId = window.requestAnimationFrame(() => {
        paintFrameId = window.requestAnimationFrame(markWebFirstHomeCompletePaint);
      });
    } else {
      fallbackId = window.setTimeout(markWebFirstHomeCompletePaint, 0);
    }

    return () => {
      if (firstFrameId !== undefined) window.cancelAnimationFrame(firstFrameId);
      if (paintFrameId !== undefined) window.cancelAnimationFrame(paintFrameId);
      if (fallbackId !== undefined) window.clearTimeout(fallbackId);
    };
  }, [
    categoriesServerSnapshotReady,
    localCurrencyReady,
    needsYearlyTotal,
    serverSnapshotReady,
    yearlyTotal,
  ]);

  useEffect(() => {
    if (!needsYearlyTotal) {
      setYearlyTotal(null);
      setYearlyExpenses([]);
      return undefined;
    }
    if (!isSessionVerified) {
      return undefined;
    }

    // 첫 화면에 필요한 월간 원장을 먼저 표시한 뒤 연간 합계를 구독합니다.
    // 두 범위 조회를 동시에 시작해 Android WebView의 초기 네트워크를 경합시키지 않습니다.
    if (!serverSnapshotReady) {
      return undefined;
    }

    const startDate = `${currentYear}-01-01`;
    const endDate = `${currentYear}-12-31`;

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void import('@/lib/expenseService').then(({ subscribeToDateRangeExpenses }) => {
      if (cancelled) return;
      unsubscribe = subscribeToDateRangeExpenses(
        startDate,
        endDate,
        (yearExpenses) => {
          setYearlyExpenses(yearExpenses);
          setYearlyTotal(yearExpenses.reduce((sum, expense) => sum + expense.amount, 0));
        },
        {
          transactionType,
          // 실패를 유효한 0원으로 축약하지 않습니다. 같은 연도의 마지막 성공값이
          // 있으면 유지하고, 아직 성공값이 없으면 null 상태를 그대로 표시합니다.
          onError: () => undefined,
        }
      );
    }).catch(() => {});

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [
    currentYear,
    isSessionVerified,
    needsYearlyTotal,
    readRefreshKey,
    serverSnapshotReady,
    transactionType,
  ]);

  useEffect(() => {
    const editId = searchParams.get('edit');
    if (!editId) {
      return;
    }

    setEditExpenseId(editId);
    router.replace(pathname, { scroll: false });
  }, [searchParams, router, pathname]);

  useEffect(() => {
    if (!editExpenseId || !serverSnapshotReady) {
      return;
    }

    const expense = expenses.find((item) => item.id === editExpenseId);
    if (expense) {
      setSelectedDate(expense.date);
      setAutoEditExpenseId(editExpenseId);
      setEditExpenseId(null);
      return;
    }

    setShowSearchModal(true);
    setEditExpenseId(null);
  }, [editExpenseId, expenses, serverSnapshotReady]);

  const selectedDateExpenses = useMemo(() => {
    if (!selectedDate) return [];
    return orderLedgerTransactions(
      expenses.filter((expense) => expense.date === selectedDate)
    );
  }, [selectedDate, expenses]);

  const handlePrevMonth = () => {
    if (currentMonth === 1) {
      setCurrentYear(currentYear - 1);
      setCurrentMonth(12);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
    setSelectedDate(null);
  };

  const handleNextMonth = () => {
    if (currentMonth === 12) {
      setCurrentYear(currentYear + 1);
      setCurrentMonth(1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
    setSelectedDate(null);
  };

  const handleDateClick = (date: string) => {
    setSelectedDate(selectedDate === date ? null : date);
  };

  const handleYearMonthChange = (newYear: number, newMonth: number) => {
    setCurrentYear(newYear);
    setCurrentMonth(newMonth);
    setSelectedDate(null);
  };

  const selectedCategoryExpenses = useMemo(() => {
    if (!selectedCategory) return [];
    return expenses
      .filter((expense) => expense.category === selectedCategory)
      .sort((left, right) => right.date.localeCompare(left.date));
  }, [expenses, selectedCategory]);

  const handleCategoryClick = (category: Category) => {
    setSelectedCategory(category);
  };

  const handleLocalCurrencyClick = (items: Expense[]) => {
    setLocalCurrencyExpenses([...items].sort((a, b) => b.date.localeCompare(a.date)));
    setShowLocalCurrencyModal(true);
  };

  const handleMonthlyIncomeClick = () => {
    if (!isIncome) {
      return;
    }

    setIncomeSummaryMode('monthly');
  };

  const handleYearlyIncomeClick = () => {
    if (!isIncome) {
      return;
    }

    setIncomeSummaryMode('yearly');
  };

  const handleExpenseUpdate = async (
    expenseId: string,
    data: { amount?: number; memo?: string; category?: string; merchant?: string; date?: string }
  ) => {
    const expense = expenses.find((item) => item.id === expenseId)
      ?? yearlyExpenses.find((item) => item.id === expenseId);
    if (!expense) throw new Error('수정할 거래의 최신 버전을 찾을 수 없습니다.');
    const { updateExpense } = await import('@/lib/expenseService');
    await updateExpense(expenseId, data, expense.aggregateVersion);
  };

  const handleSaveMerchantRule = async (merchantName: string, category: string) => {
    if (isIncome) {
      return;
    }

    if (!householdKey) throw new Error('인증된 가구 세션이 필요합니다.');
    const householdId = householdKey;
    const { addMerchantRule } = await import('@/lib/merchantRuleService');
    await addMerchantRule(householdId, merchantName, category, true);
  };

  const handleAddExpense = async (
    merchant: string,
    amount: number,
    category: string,
    date: string,
    memo?: string,
    splitMonths?: number
  ) => {
    if (splitMonths && splitMonths > 1) {
      const { addManualMonthlySplit } = await import('@/lib/expenseService');
      await addManualMonthlySplit(merchant, amount, category, date, splitMonths, memo);
      return;
    }

    const { addManualExpense } = await import('@/lib/expenseService');
    await addManualExpense(merchant, amount, category, date, memo, transactionType);
  };

  const handleDeleteExpense = async (expenseId: string) => {
    const expense = expenses.find((item) => item.id === expenseId)
      ?? yearlyExpenses.find((item) => item.id === expenseId);
    if (!expense) throw new Error('삭제할 거래의 최신 버전을 찾을 수 없습니다.');
    const { deleteExpense } = await import('@/lib/expenseService');
    await deleteExpense(expenseId, expense.aggregateVersion);
  };

  const handleSplitExpense = async (expense: Expense, splits: SplitItem[]) => {
    const { splitExpense } = await import('@/lib/expenseService');
    await splitExpense(expense, splits);
  };

  const handleMergeExpenses = async (targetExpense: Expense, sourceExpense: Expense) => {
    const { mergeExpenses } = await import('@/lib/expenseService');
    await mergeExpenses(targetExpense, sourceExpense);
  };

  const handleUnmergeExpense = async (expense: Expense) => {
    const { unmergeExpense } = await import('@/lib/expenseService');
    await unmergeExpense(expense);
  };

  return (
    <main className="min-h-screen p-4 md:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <HomeHeader
          onSearchClick={() => setShowSearchModal(true)}
          transactionType={transactionType}
        />

        {readError != null && serverSnapshotReady && (
          <div
            role="status"
            className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
          >
            최신 내역을 확인하지 못했습니다. 기존 내역을 유지한 채 연결을 복구하고 있습니다.
          </div>
        )}

        {showAddModal && (
          <AddExpenseModal
            isOpen={true}
            onClose={() => setShowAddModal(false)}
            onAdd={handleAddExpense}
            selectedDate={selectedDate}
            transactionType={transactionType}
          />
        )}

        {showSearchModal && (
          <SearchModal
            isOpen={true}
            onClose={() => setShowSearchModal(false)}
            onExpenseUpdate={handleExpenseUpdate}
            onDelete={handleDeleteExpense}
            onSplitExpense={handleSplitExpense}
            transactionType={transactionType}
          />
        )}

        <div className={`grid gap-6 ${isIncome ? '' : 'lg:grid-cols-4'}`}>
          <BalanceCards
            currentYear={currentYear}
            currentMonth={currentMonth}
            expenses={expenses}
            yearlySpent={yearlyTotal}
            summaryConfig={homeSummaryConfig}
            transactionType={transactionType}
            localCurrencyBalance={localCurrencyBalance}
            ledgerReady={serverSnapshotReady}
            categoriesReady={!categoriesLoading}
            className={isIncome
              ? 'order-1'
              : 'order-1 lg:col-span-3 lg:col-start-2 lg:row-start-1'}
            onLocalCurrencyClick={isIncome ? undefined : handleLocalCurrencyClick}
            onMonthlyIncomeClick={isIncome ? handleMonthlyIncomeClick : undefined}
            onYearlyIncomeClick={isIncome ? handleYearlyIncomeClick : undefined}
          />

          <div
            key={`${transactionType}-${currentYear}-${currentMonth}`}
            className={isIncome
              ? 'order-2'
              : 'order-2 lg:col-span-3 lg:col-start-2 lg:row-start-2'}
          >
            <Calendar
              year={currentYear}
              month={currentMonth}
              expenses={expenses}
              onDateClick={handleDateClick}
              selectedDate={selectedDate}
              onPrevMonth={handlePrevMonth}
              onNextMonth={handleNextMonth}
              isLoading={isLoading}
              onYearMonthChange={handleYearMonthChange}
            />
          </div>

          {selectedDate && (
            <div className={isIncome
              ? 'order-3 min-w-0'
              : 'order-3 min-w-0 lg:col-span-3 lg:col-start-2 lg:row-start-3'}
            >
              <ExpenseDetail
                key={`${transactionType}-${selectedDate}`}
                date={selectedDate}
                expenses={selectedDateExpenses}
                onExpenseUpdate={handleExpenseUpdate}
                onSaveMerchantRule={isIncome ? undefined : handleSaveMerchantRule}
                onDelete={handleDeleteExpense}
                onAddExpense={() => setShowAddModal(true)}
                onSplitExpense={handleSplitExpense}
                onMergeExpenses={isIncome ? undefined : handleMergeExpenses}
                onUnmergeExpense={isIncome ? undefined : handleUnmergeExpense}
                autoEditExpenseId={autoEditExpenseId}
                onAutoEditHandled={() => setAutoEditExpenseId(null)}
                transactionType={transactionType}
              />
            </div>
          )}

          {!isIncome && (
            <div className="order-4 rounded-2xl border border-slate-200/70 bg-white/95 p-6 shadow-sm transition-all hover:shadow-md lg:col-start-1 lg:row-span-3 lg:row-start-1">
              <h3 className="mb-4 text-sm font-semibold text-slate-700">
                카테고리별 {transactionLabel}
              </h3>
              {isLoading || categoriesLoading || expenses.length > 0 ? (
                <CategorySummary
                  expenses={expenses}
                  ledgerLoading={isLoading}
                  onCategoryClick={handleCategoryClick}
                  showBudgetProgress={true}
                />
              ) : (
                <div className="py-4 text-center text-slate-400">
                  {readError
                    ? '가계부를 불러오지 못했습니다.'
                    : '데이터가 없습니다'}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {!isIncome && selectedCategory && (
        <CategoryDetailModal
          category={selectedCategory}
          expenses={selectedCategoryExpenses}
          currentMonth={currentMonth}
          onClose={() => setSelectedCategory(null)}
          onExpenseClick={(expense) => {
            setSelectedCategory(null);
            setSelectedDate(expense.date);
            // 이미 메모리에 있는 항목은 URL/deep-link 해석 effect를 다시 거치지 않습니다.
            setAutoEditExpenseId(expense.id);
          }}
          transactionType={transactionType}
        />
      )}

      {!isIncome && showLocalCurrencyModal && (
        <LocalCurrencyModal
          expenses={localCurrencyExpenses}
          currentMonth={currentMonth}
          onClose={() => setShowLocalCurrencyModal(false)}
          onExpenseClick={(expense) => {
            setShowLocalCurrencyModal(false);
            setSelectedDate(expense.date);
            setAutoEditExpenseId(expense.id);
          }}
        />
      )}

      {isIncome && incomeSummaryMode && (
        <IncomeSummaryModal
          isOpen={true}
          mode={incomeSummaryMode}
          expenses={incomeSummaryMode === 'monthly' ? expenses : yearlyExpenses}
          currentYear={currentYear}
          currentMonth={currentMonth}
          onClose={() => setIncomeSummaryMode(null)}
          onExpenseUpdate={handleExpenseUpdate}
          onDelete={handleDeleteExpense}
        />
      )}
    </main>
  );
}
