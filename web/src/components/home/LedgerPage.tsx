'use client';

import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import Calendar from '@/components/Calendar';
import CategorySummary from '@/components/CategorySummary';
import { Expense, Category, TransactionType } from '@/types/expense';
import { DEFAULT_HOME_SUMMARY_CONFIG } from '@/types/household';
import BalanceCards from '@/components/BalanceCards';
import HomeHeader from '@/components/HomeHeader';
import type { SplitItem } from '@/lib/expenseService';
import { readMonthlyExpenseSnapshot } from '@/features/ledger/application/monthlyExpenseSnapshot';
import { useHousehold } from '@/contexts/HouseholdContext';
import {
  markWebFirstLedgerPaint,
  markWebLedgerCacheResult,
} from '@/platform/performance/webStartupPerformance';

const ExpenseDetail = dynamic(() => import('@/components/expense/ExpenseDetail'));
const AddExpenseModal = dynamic(() => import('@/components/expense/AddExpenseModal'));
const IncomeSummaryModal = dynamic(() => import('@/components/expense/IncomeSummaryModal'));
const SearchModal = dynamic(() => import('@/components/search/SearchModal'));
const CategoryDetailModal = dynamic(() => import('@/components/CategoryDetailModal'));
const LocalCurrencyModal = dynamic(() => import('@/components/LocalCurrencyModal'));

interface LedgerPageProps {
  transactionType: TransactionType;
}

export default function LedgerPage({ transactionType }: LedgerPageProps) {
  const isIncome = transactionType === 'income';
  const transactionLabel = isIncome ? '수입' : '지출';
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { household, householdKey, isSessionVerified = true } = useHousehold();

  const [currentYear, setCurrentYear] = useState(() => new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(() => new Date().getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [yearlyExpenses, setYearlyExpenses] = useState<Expense[]>([]);
  const [yearlyTotal, setYearlyTotal] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null);
  const [editExpenseId, setEditExpenseId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [showLocalCurrencyModal, setShowLocalCurrencyModal] = useState(false);
  const [localCurrencyExpenses, setLocalCurrencyExpenses] = useState<Expense[]>([]);
  const [autoEditExpenseId, setAutoEditExpenseId] = useState<string | null>(null);
  const [incomeSummaryMode, setIncomeSummaryMode] = useState<'monthly' | 'yearly' | null>(null);
  const [isDesktopLayout, setIsDesktopLayout] = useState(false);

  const homeSummaryConfig = household?.homeSummaryConfig || DEFAULT_HOME_SUMMARY_CONFIG;
  const needsYearlyTotal =
    isIncome ||
    homeSummaryConfig.leftCard === 'yearlySpent' ||
    homeSummaryConfig.rightCard === 'yearlySpent';

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const mediaQuery = window.matchMedia('(min-width: 1024px)');
    const applyLayout = (matches: boolean) => {
      setIsDesktopLayout(matches);
    };

    applyLayout(mediaQuery.matches);

    const handleChange = (event: MediaQueryListEvent) => {
      applyLayout(event.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useLayoutEffect(() => {
    const cached = readMonthlyExpenseSnapshot(currentYear, currentMonth, transactionType);
    markWebLedgerCacheResult(cached !== undefined);
    setExpenses(cached ?? []);
    setIsLoading(cached === undefined);
  }, [currentYear, currentMonth, transactionType]);

  useEffect(() => {
    if (isLoading) return undefined;

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
  }, [isLoading]);

  useEffect(() => {
    if (!isSessionVerified) return;

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void import('@/lib/expenseService').then(({ subscribeToMonthlyExpenses }) => {
      if (cancelled) return;
      unsubscribe = subscribeToMonthlyExpenses(
        currentYear,
        currentMonth,
        (newExpenses) => {
          setExpenses(newExpenses);
          setIsLoading(false);
        },
        { transactionType }
      );
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [currentYear, currentMonth, isSessionVerified, transactionType]);

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
    if (isLoading) {
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
        { transactionType }
      );
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [currentYear, isLoading, isSessionVerified, needsYearlyTotal, transactionType]);

  useEffect(() => {
    const editId = searchParams.get('edit');
    if (!editId) {
      return;
    }

    setEditExpenseId(editId);
    router.replace(pathname, { scroll: false });
  }, [searchParams, router, pathname]);

  useEffect(() => {
    if (!editExpenseId || expenses.length === 0) {
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
  }, [editExpenseId, expenses]);

  const selectedDateExpenses = useMemo(() => {
    if (!selectedDate) return [];
    return expenses.filter((expense) => expense.date === selectedDate);
  }, [selectedDate, expenses]);

  const handlePrevMonth = () => {
    setSlideDirection('right');
    if (currentMonth === 1) {
      setCurrentYear(currentYear - 1);
      setCurrentMonth(12);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
    setSelectedDate(null);
  };

  const handleNextMonth = () => {
    setSlideDirection('left');
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

        <BalanceCards
          currentYear={currentYear}
          currentMonth={currentMonth}
          expenses={expenses}
          yearlySpent={yearlyTotal}
          summaryConfig={homeSummaryConfig}
          transactionType={transactionType}
          className="mb-4 lg:hidden"
          onLocalCurrencyClick={isIncome ? undefined : handleLocalCurrencyClick}
          onMonthlyIncomeClick={isIncome ? () => handleMonthlyIncomeClick() : undefined}
          onYearlyIncomeClick={isIncome ? handleYearlyIncomeClick : undefined}
        />

        <div className="space-y-6 lg:hidden">
          <div
            key={`${transactionType}-${currentYear}-${currentMonth}`}
            className={
              slideDirection === 'left'
                ? 'animate-slideLeft'
                : slideDirection === 'right'
                  ? 'animate-slideRight'
                  : ''
            }
          >
            <Calendar
              year={currentYear}
              month={currentMonth}
              expenses={expenses}
              onDateClick={handleDateClick}
              selectedDate={selectedDate}
              onPrevMonth={handlePrevMonth}
              onNextMonth={handleNextMonth}
              onYearMonthChange={handleYearMonthChange}
            />
          </div>

          {selectedDate && (
            <ExpenseDetail
              key={`${transactionType}-${selectedDate}`}
              date={selectedDate}
              expenses={selectedDateExpenses}
              onExpenseUpdate={handleExpenseUpdate}
              onSaveMerchantRule={isIncome ? undefined : handleSaveMerchantRule}
              onDelete={handleDeleteExpense}
              onAddExpense={() => setShowAddModal(true)}
              onSplitExpense={handleSplitExpense}
              onMergeExpenses={handleMergeExpenses}
              onUnmergeExpense={handleUnmergeExpense}
              autoEditExpenseId={isDesktopLayout ? null : autoEditExpenseId}
              onAutoEditHandled={() => setAutoEditExpenseId(null)}
              transactionType={transactionType}
            />
          )}

          {!isIncome && (
            <div className="rounded-2xl border border-slate-200/70 bg-white/95 p-6 shadow-sm transition-all hover:shadow-md">
              <h3 className="mb-4 text-sm font-semibold text-slate-700">
                카테고리별 {transactionLabel}
              </h3>
              {expenses.length > 0 ? (
                <CategorySummary
                  expenses={expenses}
                  onCategoryClick={handleCategoryClick}
                  showBudgetProgress={!isIncome}
                />
              ) : (
                <div className="py-4 text-center text-slate-400">
                  {isLoading ? '로딩 중...' : '데이터가 없습니다'}
                </div>
              )}
            </div>
          )}
        </div>

        <div className={`hidden gap-6 lg:grid ${isIncome ? 'lg:grid-cols-1' : 'lg:grid-cols-4'}`}>
          {!isIncome && (
            <div className="space-y-6 lg:col-span-1">
              <div className="rounded-2xl border border-slate-200/70 bg-white/95 p-6 shadow-sm transition-all hover:shadow-md">
                <h3 className="mb-4 text-sm font-semibold text-slate-700">
                  카테고리별 {transactionLabel}
                </h3>
                {expenses.length > 0 ? (
                  <CategorySummary
                    expenses={expenses}
                    onCategoryClick={handleCategoryClick}
                    showBudgetProgress={!isIncome}
                  />
                ) : (
                  <div className="py-4 text-center text-slate-400">
                    {isLoading ? '로딩 중...' : '데이터가 없습니다'}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className={`space-y-6 ${isIncome ? '' : 'lg:col-span-3'}`}>
            <BalanceCards
              currentYear={currentYear}
              currentMonth={currentMonth}
              expenses={expenses}
              yearlySpent={yearlyTotal}
              summaryConfig={homeSummaryConfig}
              transactionType={transactionType}
              onLocalCurrencyClick={isIncome ? undefined : handleLocalCurrencyClick}
              onMonthlyIncomeClick={isIncome ? () => handleMonthlyIncomeClick() : undefined}
              onYearlyIncomeClick={isIncome ? handleYearlyIncomeClick : undefined}
            />

            <div
              key={`desktop-${transactionType}-${currentYear}-${currentMonth}`}
              className={
                slideDirection === 'left'
                  ? 'animate-slideLeft'
                  : slideDirection === 'right'
                    ? 'animate-slideRight'
                    : ''
              }
            >
              <Calendar
                year={currentYear}
                month={currentMonth}
                expenses={expenses}
                onDateClick={handleDateClick}
                selectedDate={selectedDate}
                onPrevMonth={handlePrevMonth}
                onNextMonth={handleNextMonth}
                onYearMonthChange={handleYearMonthChange}
              />
            </div>

            {selectedDate && (
              <ExpenseDetail
                key={`${transactionType}-desktop-${selectedDate}`}
                date={selectedDate}
                expenses={selectedDateExpenses}
                onExpenseUpdate={handleExpenseUpdate}
                onSaveMerchantRule={isIncome ? undefined : handleSaveMerchantRule}
                onDelete={handleDeleteExpense}
                onAddExpense={() => setShowAddModal(true)}
                onSplitExpense={handleSplitExpense}
                onMergeExpenses={handleMergeExpenses}
                onUnmergeExpense={handleUnmergeExpense}
                autoEditExpenseId={isDesktopLayout ? autoEditExpenseId : null}
                onAutoEditHandled={() => setAutoEditExpenseId(null)}
                transactionType={transactionType}
              />
            )}
          </div>
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
            setEditExpenseId(expense.id);
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
            setEditExpenseId(expense.id);
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
