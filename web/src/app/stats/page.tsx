'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import DonutChart from '@/components/DonutChart';
import MonthlyTrendChart from '@/components/MonthlyTrendChart';
import PeriodSelector, { PeriodPreset } from '@/components/stats/PeriodSelector';
import CategoryExpenseModal from '@/components/stats/CategoryExpenseModal';
import ExpenseEditModal from '@/components/expense/ExpenseEditModal';
import { Expense, Category } from '@/types/expense';
import { subscribeToDateRangeExpenses, updateExpense, deleteExpense } from '@/lib/expenseService';
import { addMerchantRule } from '@/lib/merchantRuleService';
import { getStoredHouseholdKey } from '@/lib/householdService';
import { ExpenseUpdates } from '@/lib/utils/expenseForm';
import { useCategoryContext } from '@/contexts/CategoryContext';
import { useTheme } from '@/contexts/ThemeContext';

const DEFAULT_CATEGORY_KEYS = ['food', 'living', 'childcare'];

function formatDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function StatsPage() {
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('1year');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [enabledCategories, setEnabledCategories] = useState<Set<string>>(new Set(DEFAULT_CATEGORY_KEYS));
  const [hasInitializedCategories, setHasInitializedCategories] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [selectedCategoryExpenses, setSelectedCategoryExpenses] = useState<Expense[]>([]);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  const { activeCategories } = useCategoryContext();
  const { themeConfig } = useTheme();

  useEffect(() => {
    if (hasInitializedCategories || activeCategories.length === 0) {
      return;
    }

    const budgetedCategoryKeys = activeCategories
      .filter((category) => category.budget !== null)
      .map((category) => category.key);

    setEnabledCategories(
      new Set(budgetedCategoryKeys.length > 0 ? budgetedCategoryKeys : DEFAULT_CATEGORY_KEYS)
    );
    setHasInitializedCategories(true);
  }, [activeCategories, hasInitializedCategories]);

  const handleCategoryClick = (category: Category, categoryExpenses: Expense[]) => {
    setSelectedCategory(category);
    setSelectedCategoryExpenses([...categoryExpenses].sort((a, b) => b.date.localeCompare(a.date)));
  };

  const handleSaveEdit = async (expense: Expense, updates: ExpenseUpdates) => {
    try {
      await updateExpense(expense.id, updates);

      if (updates.category && updates.category !== expense.category) {
        setSelectedCategoryExpenses((prev) => prev.filter((item) => item.id !== expense.id));
      } else {
        setSelectedCategoryExpenses((prev) =>
          prev.map((item) => (item.id === expense.id ? { ...item, ...updates } : item))
        );
      }
    } finally {
      setEditingExpense(null);
    }
  };

  const handleSaveMerchantRule = async (merchantName: string, category: string) => {
    const householdId = getStoredHouseholdKey() || 'guest';
    await addMerchantRule(householdId, merchantName, category, true);
  };

  const handleDeleteExpense = async (expense: Expense) => {
    try {
      await deleteExpense(expense.id);
      setSelectedCategoryExpenses((prev) => prev.filter((item) => item.id !== expense.id));
    } finally {
      setEditingExpense(null);
    }
  };

  const { startDate, endDate } = useMemo(() => {
    const now = new Date();

    if (periodPreset === 'custom' && customStartDate && customEndDate) {
      return { startDate: customStartDate, endDate: customEndDate };
    }

    let start: Date;
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    switch (periodPreset) {
      case '3months':
        start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
        break;
      case '6months':
        start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
        break;
      case '1year':
      default:
        start = new Date(now.getFullYear() - 1, now.getMonth() + 1, 1);
        break;
    }

    return { startDate: formatDate(start), endDate: formatDate(end) };
  }, [periodPreset, customStartDate, customEndDate]);

  useEffect(() => {
    if (!startDate || !endDate) {
      return;
    }

    setIsLoading(true);

    const unsubscribe = subscribeToDateRangeExpenses(startDate, endDate, (newExpenses) => {
      setExpenses(newExpenses);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [startDate, endDate]);

  const filteredExpenses = useMemo(() => {
    if (enabledCategories.has('all')) {
      return expenses;
    }

    return expenses.filter((expense) => enabledCategories.has(expense.category));
  }, [expenses, enabledCategories]);

  const totalAmount = filteredExpenses.reduce((sum, expense) => sum + expense.amount, 0);

  const filterLabel = useMemo(() => {
    if (enabledCategories.has('all')) {
      return null;
    }

    const selectedLabels = activeCategories
      .filter((category) => enabledCategories.has(category.key))
      .map((category) => category.label);

    return selectedLabels.length > 0 ? selectedLabels.join(', ') : null;
  }, [enabledCategories, activeCategories]);

  const periodLabel = useMemo(() => {
    if (!startDate || !endDate) {
      return '';
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    return `${start.getFullYear()}.${start.getMonth() + 1} - ${end.getFullYear()}.${end.getMonth() + 1}`;
  }, [startDate, endDate]);

  return (
    <main className="min-h-screen p-4 md:p-6 lg:p-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6">
          <div className="mb-2 flex items-center gap-4">
            <Link href="/" className="text-slate-500 transition-colors hover:text-slate-700">
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1
              className="text-lg md:text-xl font-bold"
              style={{
                background: themeConfig.titleGradient,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              지출 통계
            </h1>
          </div>
        </header>

        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200/70 bg-white/95 p-4 shadow-sm backdrop-blur-sm">
            <PeriodSelector
              periodPreset={periodPreset}
              onPresetChange={setPeriodPreset}
              customRange={{
                startDate: customStartDate,
                endDate: customEndDate,
                onStartDateChange: setCustomStartDate,
                onEndDateChange: setCustomEndDate,
              }}
            />

            <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
              <div className="text-sm text-slate-500">{periodLabel}</div>
              <div className="text-right">
                {filterLabel ? <div className="mb-1 text-xs text-blue-500">{filterLabel}</div> : null}
                <div className="flex items-baseline justify-end gap-1">
                  <span className="text-sm text-slate-500">총</span>
                  {isLoading ? (
                    <span className="text-lg text-slate-400">로딩중...</span>
                  ) : (
                    <span className="text-xl font-bold text-slate-800">{totalAmount.toLocaleString()}원</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/70 bg-white/95 p-6 shadow-sm backdrop-blur-sm">
            <h3 className="mb-4 text-lg font-semibold text-slate-700">월별 지출 추이</h3>
            {isLoading ? (
              <div className="flex h-72 items-center justify-center text-slate-400">로딩중...</div>
            ) : expenses.length > 0 ? (
              <MonthlyTrendChart
                expenses={expenses}
                startDate={startDate}
                endDate={endDate}
                enabledCategories={enabledCategories}
                onCategoryToggle={setEnabledCategories}
              />
            ) : (
              <div className="flex h-72 items-center justify-center text-slate-400">데이터가 없습니다</div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200/70 bg-white/95 p-6 shadow-sm backdrop-blur-sm">
            <h3 className="mb-4 text-lg font-semibold text-slate-700">
              카테고리별 비중
              {filterLabel ? <span className="ml-2 text-sm font-normal text-blue-500">({filterLabel})</span> : null}
            </h3>
            <div className="min-h-64">
              {filteredExpenses.length > 0 ? (
                <DonutChart expenses={filteredExpenses} onCategoryClick={handleCategoryClick} />
              ) : (
                <div className="flex h-64 items-center justify-center text-slate-400">
                  {isLoading ? '로딩중...' : '데이터가 없습니다'}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {selectedCategory ? (
        <CategoryExpenseModal
          category={selectedCategory}
          expenses={selectedCategoryExpenses}
          onClose={() => setSelectedCategory(null)}
          onExpenseClick={setEditingExpense}
        />
      ) : null}

      {editingExpense ? (
        <ExpenseEditModal
          expense={editingExpense}
          isOpen={!!editingExpense}
          onClose={() => setEditingExpense(null)}
          onSave={(updates) => {
            void handleSaveEdit(editingExpense, updates);
          }}
          onSaveMerchantRule={(merchantName, category) => {
            void handleSaveMerchantRule(merchantName, category);
          }}
          onDelete={() => {
            void handleDeleteExpense(editingExpense);
          }}
          transactionType="expense"
        />
      ) : null}
    </main>
  );
}
