'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import DonutChart from '@/components/DonutChart';
import MonthlyTrendChart from '@/components/MonthlyTrendChart';
import PeriodSelector, { PeriodPreset } from '@/components/stats/PeriodSelector';
import CategoryExpenseModal from '@/components/stats/CategoryExpenseModal';
import StatsExpenseEditModal from '@/components/stats/StatsExpenseEditModal';
import { Expense, Category } from '@/types/expense';
import { subscribeToDateRangeExpenses, updateExpense, deleteExpense } from '@/lib/expenseService';
import { addMerchantRule } from '@/lib/merchantRuleService';
import { getStoredHouseholdKey } from '@/lib/householdService';
import { useCategoryContext } from '@/contexts/CategoryContext';

export default function StatsPage() {
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('1month');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // 카테고리 필터 상태 (월별 추이 차트와 공유) - 기본값: 식비, 생활비, 육아비
  const [enabledCategories, setEnabledCategories] = useState<Set<string>>(() => new Set(['food', 'living', 'childcare']));

  // 카테고리 상세 모달 상태
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [selectedCategoryExpenses, setSelectedCategoryExpenses] = useState<Expense[]>([]);
  const { activeCategories } = useCategoryContext();

  // 지출 수정 모달 상태
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  const handleCategoryClick = (category: Category, categoryExpenses: Expense[]) => {
    setSelectedCategory(category);
    // 날짜 내림차순 정렬
    setSelectedCategoryExpenses(
      [...categoryExpenses].sort((a, b) => b.date.localeCompare(a.date))
    );
  };

  // 지출 수정 저장
  const handleSaveEdit = async (
    expense: Expense,
    updates: { amount?: number; memo?: string; category?: string },
    rememberMerchant: boolean,
  ) => {
    try {
      await updateExpense(expense.id, updates);

      // 카테고리가 변경되었고 기억하기 체크했으면 규칙 저장
      if (updates.category && updates.category !== expense.category && rememberMerchant) {
        const householdId = getStoredHouseholdKey() || 'guest';
        await addMerchantRule(householdId, expense.merchant, updates.category, true);
      }

      // 카테고리가 변경되면 현재 모달의 리스트에서 제거
      if (updates.category && updates.category !== expense.category) {
        setSelectedCategoryExpenses(prev =>
          prev.filter(e => e.id !== expense.id)
        );
      } else {
        // 카테고리가 같으면 리스트에서 해당 항목 업데이트
        setSelectedCategoryExpenses(prev =>
          prev.map(e => e.id === expense.id
            ? { ...e, ...updates }
            : e
          )
        );
      }
    } catch (error) {
    }

    setEditingExpense(null);
  };

  // 지출 삭제
  const handleDeleteExpense = async (expense: Expense) => {
    try {
      await deleteExpense(expense.id);
      // 리스트에서 제거
      setSelectedCategoryExpenses(prev =>
        prev.filter(e => e.id !== expense.id)
      );
    } catch (error) {
    }

    setEditingExpense(null);
  };

  // 날짜 범위 계산
  const { startDate, endDate } = useMemo(() => {
    const now = new Date();
    let start: Date;
    let end = new Date(now.getFullYear(), now.getMonth() + 1, 0); // 이번 달 마지막 날

    if (periodPreset === 'custom' && customStartDate && customEndDate) {
      return { startDate: customStartDate, endDate: customEndDate };
    }

    switch (periodPreset) {
      case '1month':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case '3months':
        start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
        break;
      case '6months':
        start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
        break;
      case '1year':
        start = new Date(now.getFullYear() - 1, now.getMonth() + 1, 1);
        break;
      default:
        start = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const formatDate = (d: Date) => {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    return { startDate: formatDate(start), endDate: formatDate(end) };
  }, [periodPreset, customStartDate, customEndDate]);

  // Firebase 실시간 구독
  useEffect(() => {
    if (!startDate || !endDate) return;

    setIsLoading(true);

    const unsubscribe = subscribeToDateRangeExpenses(
      startDate,
      endDate,
      (newExpenses) => {
        setExpenses(newExpenses);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [startDate, endDate]);

  // 필터링된 지출 (선택된 카테고리만)
  const filteredExpenses = useMemo(() => {
    if (enabledCategories.has('all')) {
      return expenses;
    }
    return expenses.filter((e) => enabledCategories.has(e.category));
  }, [expenses, enabledCategories]);

  // 총 지출 (필터링된 것 기준)
  const totalAmount = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);

  // 필터 라벨 (선택된 카테고리 표시)
  const filterLabel = useMemo(() => {
    if (enabledCategories.has('all')) {
      return null;
    }
    const selectedLabels = activeCategories
      .filter((cat) => enabledCategories.has(cat.key))
      .map((cat) => cat.label);
    return selectedLabels.length > 0 ? selectedLabels.join(', ') : null;
  }, [enabledCategories, activeCategories]);

  // 기간 표시 문자열
  const periodLabel = useMemo(() => {
    if (!startDate || !endDate) return '';
    const start = new Date(startDate);
    const end = new Date(endDate);
    return `${start.getFullYear()}.${start.getMonth() + 1} - ${end.getFullYear()}.${end.getMonth() + 1}`;
  }, [startDate, endDate]);

  return (
    <main className="min-h-screen p-4 md:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto">
        {/* 헤더 */}
        <header className="mb-6">
          <div className="flex items-center gap-4 mb-2">
            <Link
              href="/"
              className="text-slate-500 hover:text-slate-700 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-2xl font-bold text-slate-800">
              통계
            </h1>
          </div>
        </header>

        <div className="space-y-6">
          {/* 기간 선택 */}
          <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-200/70 p-4">
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

            {/* 기간 & 총액 표시 */}
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-100">
              <div className="text-sm text-slate-500">{periodLabel}</div>
              <div className="text-right">
                {filterLabel && (
                  <div className="text-xs text-blue-500 mb-1">{filterLabel}</div>
                )}
                <div className="flex items-baseline gap-1 justify-end">
                  <span className="text-sm text-slate-500">총</span>
                  {isLoading ? (
                    <span className="text-lg text-slate-400">로딩중...</span>
                  ) : (
                    <span className="text-xl font-bold text-slate-800">
                      {totalAmount.toLocaleString()}원
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 월별 추이 차트 */}
          <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-200/70 p-6">
            <h3 className="text-lg font-semibold text-slate-700 mb-4">
              월별 지출 추이
            </h3>
            {isLoading ? (
              <div className="h-72 flex items-center justify-center text-slate-400">
                로딩중...
              </div>
            ) : expenses.length > 0 ? (
              <MonthlyTrendChart
                expenses={expenses}
                startDate={startDate}
                endDate={endDate}
                enabledCategories={enabledCategories}
                onCategoryToggle={setEnabledCategories}
              />
            ) : (
              <div className="h-72 flex items-center justify-center text-slate-400">
                데이터 없음
              </div>
            )}
          </div>

          {/* 도넛 차트 - 선택된 카테고리 기준 */}
          <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-200/70 p-6">
            <h3 className="text-lg font-semibold text-slate-700 mb-4">
              카테고리별 비율
              {filterLabel && (
                <span className="text-sm font-normal text-blue-500 ml-2">({filterLabel})</span>
              )}
            </h3>
            <div className="min-h-64">
              {filteredExpenses.length > 0 ? (
                <DonutChart expenses={filteredExpenses} onCategoryClick={handleCategoryClick} />
              ) : (
                <div className="h-64 flex items-center justify-center text-slate-400">
                  {isLoading ? '로딩중...' : '데이터 없음'}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 카테고리 지출 내역 모달 */}
      {selectedCategory && (
        <CategoryExpenseModal
          category={selectedCategory}
          expenses={selectedCategoryExpenses}
          onClose={() => setSelectedCategory(null)}
          onExpenseClick={setEditingExpense}
        />
      )}

      {/* 지출 수정 모달 */}
      {editingExpense && (
        <StatsExpenseEditModal
          expense={editingExpense}
          onClose={() => setEditingExpense(null)}
          onSave={handleSaveEdit}
          onDelete={handleDeleteExpense}
        />
      )}
    </main>
  );
}
