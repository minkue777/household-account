'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import DonutChart from '@/components/DonutChart';
import MonthlyTrendChart from '@/components/MonthlyTrendChart';
import PeriodSelector, { PeriodPreset } from '@/components/stats/PeriodSelector';
import CategoryExpenseModal from '@/components/stats/CategoryExpenseModal';
import ExpenseEditModal from '@/components/expense/ExpenseEditModal';
import { Expense, Category } from '@/types/expense';
import { updateExpense, deleteExpense } from '@/lib/expenseService';
import { loadExpenseStatistics, peekExpenseStatistics, type ExpenseStatisticsQuery } from '@/platform/reporting/expenseStatisticsCache';
import { expenseStatisticsActorKey, getExpenseStatisticsRevision, subscribeExpenseStatisticsInvalidation } from '@/platform/reporting/expenseStatisticsInvalidation';
import { getClientSessionScope } from '@/composition/clientSessionScope';
import { ANDROID_NATIVE_RESUME_EVENT } from '@/platform/android-host/androidLifecycleEvents';
import { resolveExpenseStatisticsPeriod } from '@/features/reporting/statisticsPeriod';
import { ExpenseUpdates } from '@/lib/utils/expenseForm';
import { useCategoryContext } from '@/contexts/CategoryContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useHousehold } from '@/contexts/HouseholdContext';

const DEFAULT_CATEGORY_KEYS = ['food', 'living', 'childcare'];

export default function StatsPage() {
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('1year');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [readState, setReadState] = useState<{ key: string; expenses?: Expense[]; loading: boolean; error: boolean }>({ key: '', loading: true, error: false });
  const firstRead = useRef(true);
  const lastQueryRevision = useRef(0);
  const [queryRevision, setQueryRevision] = useState(0);
  const [enabledCategories, setEnabledCategories] = useState<Set<string>>(new Set(DEFAULT_CATEGORY_KEYS));
  const [hasInitializedCategories, setHasInitializedCategories] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [modalScope, setModalScope] = useState('');

  const { activeCategories } = useCategoryContext();
  const { themeConfig } = useTheme();
  const { householdKey, currentMember, isSessionVerified = true, remoteReadEpoch = 0 } = useHousehold();
  const scope = getClientSessionScope();
  const actorKey = expenseStatisticsActorKey(scope);
  const revision = useSyncExternalStore(subscribeExpenseStatisticsInvalidation, getExpenseStatisticsRevision, () => 0);
  const { startDate, endDate, error: periodError } = useMemo(() => resolveExpenseStatisticsPeriod(periodPreset, customStartDate, customEndDate), [periodPreset, customStartDate, customEndDate]);
  const query = useMemo<ExpenseStatisticsQuery | undefined>(() => scope && scope.householdId === householdKey
    && (scope.accessMode === 'administrator-readonly' || scope.memberId === currentMember?.id) && isSessionVerified && !periodError
    ? { scope, remoteReadEpoch, revision, startDate, endDate } : undefined,
  [scope, householdKey, currentMember?.id, isSessionVerified, periodError, remoteReadEpoch, revision, startDate, endDate]);
  const requestKey = JSON.stringify([actorKey, householdKey, currentMember?.id, isSessionVerified, remoteReadEpoch, revision, startDate, endDate, periodError, queryRevision]);
  const cached = useMemo(() => query ? peekExpenseStatistics(query) : undefined, [query, queryRevision]);
  const currentRead = readState.key === requestKey ? readState : undefined;
  const expenses = currentRead?.expenses ?? cached ?? [];
  const hasResult = currentRead?.expenses !== undefined || cached !== undefined;
  const readError = currentRead?.error ?? false;
  const isLoading = !periodError && !readError && (!query || !hasResult);
  const isRefreshing = !!query && hasResult && !!currentRead?.loading;
  const modalKey = JSON.stringify([actorKey, householdKey, currentMember?.id, isSessionVerified, remoteReadEpoch, startDate, endDate, periodError]);
  const canShowModals = !!query && modalScope === modalKey;

  useEffect(() => { setHasInitializedCategories(false); setEditingExpense(null); setSelectedCategory(null); }, [householdKey, remoteReadEpoch]);
  useEffect(() => { setEditingExpense(null); setSelectedCategory(null); }, [modalKey]);

  useEffect(() => {
    if (hasInitializedCategories || activeCategories.length === 0) {
      return;
    }

    const budgetedCategoryKeys = activeCategories
      .filter((category) => category.budget !== null)
      .map((category) => category.key);

    setEnabledCategories(
      new Set(budgetedCategoryKeys.length > 0 ? budgetedCategoryKeys : DEFAULT_CATEGORY_KEYS.filter(key => activeCategories.some(category => category.key === key)))
    );
    setHasInitializedCategories(true);
  }, [activeCategories, hasInitializedCategories]);

  const handleCategoryClick = (category: Category) => {
    setModalScope(modalKey);
    setSelectedCategory(category);
  };

  const selectedCategoryExpenses = useMemo(() => {
    if (!selectedCategory) return [];
    return expenses
      .filter((expense) => expense.category === selectedCategory)
      .sort((left, right) => right.date.localeCompare(left.date));
  }, [expenses, selectedCategory]);

  const handleSaveEdit = async (expense: Expense, updates: ExpenseUpdates, rememberForNextTime = false) => {
    await updateExpense(expense.id, updates, expense.aggregateVersion, rememberForNextTime);
    if (expenseStatisticsActorKey(getClientSessionScope()) !== actorKey) return;
    setEditingExpense(null);
    setSelectedCategory(null);
    setQueryRevision(revision => revision + 1);
  };

  const handleDeleteExpense = async (expense: Expense) => {
    await deleteExpense(expense.id, expense.aggregateVersion);
    if (expenseStatisticsActorKey(getClientSessionScope()) !== actorKey) return;
    setEditingExpense(null);
    setSelectedCategory(null);
    setQueryRevision(revision => revision + 1);
  };

  useEffect(() => {
    let active = true;
    if (!query) return;
    // Re-entry and device resume show the last complete source immediately, then verify it.
    const force = firstRead.current || lastQueryRevision.current !== queryRevision;
    firstRead.current = false;
    lastQueryRevision.current = queryRevision;
    setReadState({ key: requestKey, expenses: cached, loading: true, error: false });
    void loadExpenseStatistics(query, force).then(result => {
      if (active) setReadState({ key: requestKey, expenses: result, loading: false, error: false });
    }, () => {
      if (active) setReadState({ key: requestKey, expenses: cached, loading: false, error: true });
    });
    return () => { active = false; };
  }, [query, requestKey, queryRevision, cached]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') setQueryRevision(value => value + 1);
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    window.addEventListener('online', refresh);
    window.addEventListener(ANDROID_NATIVE_RESUME_EVENT, refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
      window.removeEventListener('online', refresh);
      window.removeEventListener(ANDROID_NATIVE_RESUME_EVENT, refresh);
    };
  }, []);

  const totalAmount = expenses.reduce((sum, expense) => sum + expense.amount, 0);

  const periodLabel = useMemo(() => {
    if (!startDate || !endDate) {
      return '';
    }

    return `${startDate.slice(0, 4)}.${Number(startDate.slice(5, 7))} - ${endDate.slice(0, 4)}.${Number(endDate.slice(5, 7))}`;
  }, [startDate, endDate]);

  return (
    <main className="min-h-screen p-4 md:p-6 lg:p-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6">
          <div className="mb-2 flex items-center gap-4">
            <Link href="/" className="text-slate-500 transition-colors hover:text-slate-700">
              <ArrowLeft className="h-6 w-6" />
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
            {isRefreshing && <p role="status" className="mt-3 text-sm text-slate-500">최신 내역 확인 중...</p>}
            {(periodError || readError) && <p role="alert" className="mt-3 text-sm text-red-600">{periodError ?? '통계를 불러오지 못했습니다.'}{readError && <button type="button" className="ml-3 underline" onClick={() => setQueryRevision(value => value + 1)}>다시 시도</button>}</p>}

            <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
              <div className="text-sm text-slate-500">{periodLabel}</div>
              <div className="text-right">
                <div className="flex items-baseline justify-end gap-1">
                  <span className="text-sm text-slate-500">총</span>
                  {isLoading ? (
                    <span className="text-lg text-slate-400">로딩중...</span>
                  ) : periodError || readError ? <span>조회 실패</span> : expenses.length === 0 ? <span>데이터 없음</span> : (
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
            ) : periodError || readError ? (
              <div className="flex h-72 items-center justify-center text-slate-400">조회 실패</div>
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
            <h3 className="mb-4 text-lg font-semibold text-slate-700">카테고리별 비중</h3>
            <div className="min-h-64">
              {expenses.length > 0 ? (
                <DonutChart expenses={expenses} onCategoryClick={handleCategoryClick} />
              ) : (
                <div className="flex h-64 items-center justify-center text-slate-400">
                  {isLoading ? '로딩중...' : periodError || readError ? '조회 실패' : '데이터가 없습니다'}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {canShowModals && selectedCategory ? (
        <CategoryExpenseModal
          category={selectedCategory}
          expenses={selectedCategoryExpenses}
          onClose={() => setSelectedCategory(null)}
          onExpenseClick={setEditingExpense}
        />
      ) : null}

      {canShowModals && editingExpense ? (
        <ExpenseEditModal
          expense={editingExpense}
          isOpen={!!editingExpense}
          onClose={() => setEditingExpense(null)}
          onSave={(updates, remember) => handleSaveEdit(editingExpense, updates, remember)}
          allowRememberMerchant
          preserveDraftUntilSuccess
          onDelete={() => handleDeleteExpense(editingExpense)}
          transactionType="expense"
        />
      ) : null}
    </main>
  );
}
