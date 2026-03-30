'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Calendar from '@/components/Calendar';
import CategorySummary from '@/components/CategorySummary';
import { ExpenseDetail, AddExpenseModal, IncomeSummaryModal } from '@/components/expense';
import { SearchModal } from '@/components/search';
import { Expense, Category, TransactionType } from '@/types/expense';
import { DEFAULT_HOME_SUMMARY_CONFIG } from '@/types/household';
import BalanceCards from '@/components/BalanceCards';
import HomeHeader from '@/components/HomeHeader';
import CategoryDetailModal from '@/components/CategoryDetailModal';
import LocalCurrencyModal from '@/components/LocalCurrencyModal';
import {
  subscribeToMonthlyExpenses,
  subscribeToDateRangeExpenses,
  updateExpense,
  addManualExpense,
  deleteExpense,
  splitExpense,
  mergeExpenses,
  unmergeExpense,
  SplitItem,
  generateSplitGroupId,
  addExpense,
} from '@/lib/expenseService';
import { addMerchantRule } from '@/lib/merchantRuleService';
import { getStoredHouseholdKey } from '@/lib/householdService';
import { processRecurringExpenses } from '@/lib/recurringExpenseService';
import { getMonthlySplitDate } from '@/lib/utils/monthlySplitDate';
import { useHousehold } from '@/contexts/HouseholdContext';

interface LedgerPageProps {
  transactionType: TransactionType;
}

export default function LedgerPage({ transactionType }: LedgerPageProps) {
  const isIncome = transactionType === 'income';
  const transactionLabel = isIncome ? '수입' : '지출';
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { household, householdKey } = useHousehold();

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
  const [selectedCategoryExpenses, setSelectedCategoryExpenses] = useState<Expense[]>([]);
  const [showLocalCurrencyModal, setShowLocalCurrencyModal] = useState(false);
  const [localCurrencyExpenses, setLocalCurrencyExpenses] = useState<Expense[]>([]);
  const [autoEditExpenseId, setAutoEditExpenseId] = useState<string | null>(null);
  const [incomeSummaryMode, setIncomeSummaryMode] = useState<'monthly' | 'yearly' | null>(null);

  const homeSummaryConfig = household?.homeSummaryConfig || DEFAULT_HOME_SUMMARY_CONFIG;
  const needsYearlyTotal =
    isIncome ||
    homeSummaryConfig.leftCard === 'yearlySpent' ||
    homeSummaryConfig.rightCard === 'yearlySpent';

  useEffect(() => {
    if (!householdKey || isIncome) {
      return;
    }

    processRecurringExpenses(householdKey).then(() => undefined);
  }, [householdKey, isIncome]);

  useEffect(() => {
    setIsLoading(true);

    const unsubscribe = subscribeToMonthlyExpenses(
      currentYear,
      currentMonth,
      (newExpenses) => {
        setExpenses(newExpenses);
        setIsLoading(false);
      },
      { transactionType }
    );

    return () => unsubscribe();
  }, [currentYear, currentMonth, transactionType]);

  useEffect(() => {
    if (!needsYearlyTotal) {
      setYearlyTotal(null);
      setYearlyExpenses([]);
      return undefined;
    }

    const startDate = `${currentYear}-01-01`;
    const endDate = `${currentYear}-12-31`;

    const unsubscribe = subscribeToDateRangeExpenses(
      startDate,
      endDate,
      (yearExpenses) => {
        setYearlyExpenses(yearExpenses);
        setYearlyTotal(yearExpenses.reduce((sum, expense) => sum + expense.amount, 0));
      },
      { transactionType }
    );

    return () => unsubscribe();
  }, [currentYear, needsYearlyTotal, transactionType]);

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

  const handleCategoryClick = (category: Category, categoryExpenses: Expense[]) => {
    setSelectedCategory(category);
    setSelectedCategoryExpenses(
      [...categoryExpenses].sort((a, b) => b.date.localeCompare(a.date))
    );
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
    await updateExpense(expenseId, data);
  };

  const handleSaveMerchantRule = async (merchantName: string, category: string) => {
    if (isIncome) {
      return;
    }

    const householdId = getStoredHouseholdKey() || 'guest';
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
      const monthlyAmount = Math.floor(amount / splitMonths);
      const splitGroupId = generateSplitGroupId();

      for (let i = 0; i < splitMonths; i++) {
        const dateStr = getMonthlySplitDate(date, i);

        await addExpense(
          {
            date: dateStr,
            time: '09:00',
            merchant: `${merchant} (${i + 1}/${splitMonths})`,
            amount: monthlyAmount,
            transactionType,
            category,
            cardType: 'main',
            splitGroupId,
            splitIndex: i + 1,
            splitTotal: splitMonths,
          },
          {
            notifyOnCreate: false,
          }
        );
      }
      return;
    }

    await addManualExpense(merchant, amount, category, date, memo, transactionType);
  };

  const handleDeleteExpense = async (expenseId: string) => {
    await deleteExpense(expenseId);
  };

  const handleSplitExpense = async (expense: Expense, splits: SplitItem[]) => {
    await splitExpense(expense, splits);
  };

  const handleMergeExpenses = async (targetExpense: Expense, sourceExpense: Expense) => {
    await mergeExpenses(targetExpense, sourceExpense);
  };

  const handleUnmergeExpense = async (expense: Expense) => {
    await unmergeExpense(expense);
  };

  return (
    <main className="min-h-screen p-4 md:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <HomeHeader
          onSearchClick={() => setShowSearchModal(true)}
          transactionType={transactionType}
        />

        <AddExpenseModal
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          onAdd={handleAddExpense}
          selectedDate={selectedDate}
          transactionType={transactionType}
        />

        <SearchModal
          isOpen={showSearchModal}
          onClose={() => setShowSearchModal(false)}
          onExpenseUpdate={handleExpenseUpdate}
          onDelete={handleDeleteExpense}
          onSplitExpense={handleSplitExpense}
          transactionType={transactionType}
        />

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
              autoEditExpenseId={autoEditExpenseId}
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
                autoEditExpenseId={autoEditExpenseId}
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
