'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Calendar from '@/components/Calendar';
import CategoryDetailModal from '@/components/CategoryDetailModal';
import CategorySummary from '@/components/CategorySummary';
import BalanceCards from '@/components/BalanceCards';
import HomeHeader from '@/components/HomeHeader';
import LocalCurrencyModal from '@/components/LocalCurrencyModal';
import { ExpenseDetail, AddExpenseModal } from '@/components/expense';
import { SearchModal } from '@/components/search';
import { Category, Expense } from '@/types/expense';
import {
  SplitItem,
  addExpense,
  addManualExpense,
  deleteExpense,
  generateSplitGroupId,
  mergeExpenses,
  splitExpense,
  subscribeToMonthlyExpenses,
  unmergeExpense,
  updateExpense,
} from '@/lib/expenseService';
import { getStoredHouseholdKey } from '@/lib/householdService';
import { addMerchantRule } from '@/lib/merchantRuleService';
import { processRecurringExpenses } from '@/lib/recurringExpenseService';
import { getMonthlySplitDate } from '@/lib/utils/monthlySplitDate';

function CategoryReportSection({
  expenses,
  isLoading,
  onCategoryClick,
}: {
  expenses: Expense[];
  isLoading: boolean;
  onCategoryClick: (category: Category, categoryExpenses: Expense[]) => void;
}) {
  return (
    <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-200/70 p-6 transition-all hover:shadow-md">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-800">
            카테고리 리포트
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            예산 진행률과 지출 비중을 한눈에 확인해보세요.
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500">
          {expenses.length}건
        </span>
      </div>

      {expenses.length > 0 ? (
        <CategorySummary expenses={expenses} onCategoryClick={onCategoryClick} />
      ) : (
        <div className="py-8 text-center text-slate-400">
          {isLoading ? '로딩중...' : '데이터 없음'}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [currentYear, setCurrentYear] = useState(() => new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(() => new Date().getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null);
  const [editExpenseId, setEditExpenseId] = useState<string | null>(null);
  const [autoEditExpenseId, setAutoEditExpenseId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [selectedCategoryExpenses, setSelectedCategoryExpenses] = useState<Expense[]>([]);
  const [showLocalCurrencyModal, setShowLocalCurrencyModal] = useState(false);
  const [localCurrencyExpenses, setLocalCurrencyExpenses] = useState<Expense[]>([]);

  useEffect(() => {
    const householdId = getStoredHouseholdKey();
    if (!householdId) return;

    processRecurringExpenses(householdId).catch(() => {
      // ignore recurring processing failure on home load
    });
  }, []);

  useEffect(() => {
    setIsLoading(true);

    const unsubscribe = subscribeToMonthlyExpenses(currentYear, currentMonth, (newExpenses) => {
      setExpenses(newExpenses);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [currentYear, currentMonth]);

  useEffect(() => {
    const editId = searchParams.get('edit');
    if (!editId) return;

    setEditExpenseId(editId);
    router.replace('/', { scroll: false });
  }, [searchParams, router]);

  useEffect(() => {
    if (!editExpenseId || expenses.length === 0) return;

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

    return expenses
      .filter((expense) => expense.date === selectedDate)
      .sort((left, right) => {
        const leftTime = left.time || '';
        const rightTime = right.time || '';
        return rightTime.localeCompare(leftTime) || right.amount - left.amount;
      });
  }, [selectedDate, expenses]);

  const monthlyTotal = useMemo(
    () => expenses.reduce((sum, expense) => sum + expense.amount, 0),
    [expenses]
  );

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
      [...categoryExpenses].sort((left, right) => right.date.localeCompare(left.date))
    );
  };

  const handleLocalCurrencyClick = (targetExpenses: Expense[]) => {
    setLocalCurrencyExpenses(
      [...targetExpenses].sort((left, right) => right.date.localeCompare(left.date))
    );
    setShowLocalCurrencyModal(true);
  };

  const handleExpenseUpdate = async (
    expenseId: string,
    data: { amount?: number; memo?: string; category?: string }
  ) => {
    try {
      await updateExpense(expenseId, data);
    } catch {
      // ignore update failure
    }
  };

  const handleSaveMerchantRule = async (merchantName: string, category: string) => {
    try {
      const householdId = getStoredHouseholdKey() || 'guest';
      await addMerchantRule(householdId, merchantName, category, true);
    } catch {
      // ignore merchant rule save failure
    }
  };

  const handleAddExpense = async (
    merchant: string,
    amount: number,
    category: string,
    date: string,
    memo?: string,
    splitMonths?: number
  ) => {
    try {
      if (splitMonths && splitMonths > 1) {
        const monthlyAmount = Math.floor(amount / splitMonths);
        const splitGroupId = generateSplitGroupId();

        for (let index = 0; index < splitMonths; index++) {
          const dateStr = getMonthlySplitDate(date, index);

          await addExpense(
            {
              date: dateStr,
              time: '09:00',
              merchant: `${merchant} (${index + 1}/${splitMonths})`,
              amount: monthlyAmount,
              category,
              cardType: 'main',
              splitGroupId,
              splitIndex: index + 1,
              splitTotal: splitMonths,
            },
            {
              notifyOnCreate: false,
            }
          );
        }

        return;
      }

      await addManualExpense(merchant, amount, category, date, memo);
    } catch {
      // ignore add expense failure
    }
  };

  const handleDeleteExpense = async (expenseId: string) => {
    try {
      await deleteExpense(expenseId);
    } catch {
      // ignore delete failure
    }
  };

  const handleSplitExpense = async (expense: Expense, splits: SplitItem[]) => {
    try {
      await splitExpense(expense, splits);
    } catch {
      // ignore split failure
    }
  };

  const handleMergeExpenses = async (targetExpense: Expense, sourceExpense: Expense) => {
    try {
      await mergeExpenses(targetExpense, sourceExpense);
    } catch {
      // ignore merge failure
    }
  };

  const handleUnmergeExpense = async (expense: Expense) => {
    try {
      await unmergeExpense(expense);
    } catch {
      // ignore unmerge failure
    }
  };

  return (
    <main className="min-h-screen p-4 md:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <HomeHeader
          onSearchClick={() => setShowSearchModal(true)}
          currentMonth={currentMonth}
          totalSpent={monthlyTotal}
          expenseCount={expenses.length}
        />

        <AddExpenseModal
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          onAdd={handleAddExpense}
          selectedDate={selectedDate}
        />

        <SearchModal
          isOpen={showSearchModal}
          onClose={() => setShowSearchModal(false)}
          onExpenseUpdate={handleExpenseUpdate}
          onDelete={handleDeleteExpense}
          onSplitExpense={handleSplitExpense}
        />

        <BalanceCards
          currentMonth={currentMonth}
          expenses={expenses}
          className="lg:hidden mb-4"
          onLocalCurrencyClick={handleLocalCurrencyClick}
        />

        <div className="lg:hidden space-y-6">
          <div
            key={`${currentYear}-${currentMonth}`}
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
              monthlyTotal={monthlyTotal}
              isLoading={isLoading}
              onDateClick={handleDateClick}
              selectedDate={selectedDate}
              onPrevMonth={handlePrevMonth}
              onNextMonth={handleNextMonth}
              onYearMonthChange={handleYearMonthChange}
            />
          </div>

          {selectedDate && (
            <ExpenseDetail
              key={selectedDate}
              date={selectedDate}
              expenses={selectedDateExpenses}
              onExpenseUpdate={handleExpenseUpdate}
              onSaveMerchantRule={handleSaveMerchantRule}
              onDelete={handleDeleteExpense}
              onAddExpense={() => setShowAddModal(true)}
              onSplitExpense={handleSplitExpense}
              onMergeExpenses={handleMergeExpenses}
              onUnmergeExpense={handleUnmergeExpense}
              autoEditExpenseId={autoEditExpenseId}
              onAutoEditHandled={() => setAutoEditExpenseId(null)}
            />
          )}

          <CategoryReportSection
            expenses={expenses}
            isLoading={isLoading}
            onCategoryClick={handleCategoryClick}
          />
        </div>

        <div className="hidden lg:grid lg:grid-cols-4 gap-6">
          <div className="lg:col-span-1 space-y-6">
            <CategoryReportSection
              expenses={expenses}
              isLoading={isLoading}
              onCategoryClick={handleCategoryClick}
            />
          </div>

          <div className="lg:col-span-3 space-y-6">
            <BalanceCards
              currentMonth={currentMonth}
              expenses={expenses}
              onLocalCurrencyClick={handleLocalCurrencyClick}
            />

            <div
              key={`desktop-${currentYear}-${currentMonth}`}
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
                monthlyTotal={monthlyTotal}
                isLoading={isLoading}
                onDateClick={handleDateClick}
                selectedDate={selectedDate}
                onPrevMonth={handlePrevMonth}
                onNextMonth={handleNextMonth}
                onYearMonthChange={handleYearMonthChange}
              />
            </div>

            {selectedDate && (
              <ExpenseDetail
                key={selectedDate}
                date={selectedDate}
                expenses={selectedDateExpenses}
                onExpenseUpdate={handleExpenseUpdate}
                onSaveMerchantRule={handleSaveMerchantRule}
                onDelete={handleDeleteExpense}
                onAddExpense={() => setShowAddModal(true)}
                onSplitExpense={handleSplitExpense}
                onMergeExpenses={handleMergeExpenses}
                onUnmergeExpense={handleUnmergeExpense}
                autoEditExpenseId={autoEditExpenseId}
                onAutoEditHandled={() => setAutoEditExpenseId(null)}
              />
            )}
          </div>
        </div>
      </div>

      {selectedCategory && (
        <CategoryDetailModal
          category={selectedCategory}
          expenses={selectedCategoryExpenses}
          currentMonth={currentMonth}
          onClose={() => setSelectedCategory(null)}
        />
      )}

      {showLocalCurrencyModal && (
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
    </main>
  );
}
