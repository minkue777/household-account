'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import DonutChart from '@/components/DonutChart';
import MonthlyTrendChart from '@/components/MonthlyTrendChart';
import { Expense, Category } from '@/types/expense';
import { subscribeToDateRangeExpenses, updateExpense, deleteExpense } from '@/lib/expenseService';
import { addMerchantRule } from '@/lib/merchantRuleService';
import { getStoredHouseholdKey } from '@/lib/householdService';
import { useCategoryContext } from '@/contexts/CategoryContext';

// 기간 프리셋
type PeriodPreset = '1month' | '3months' | '6months' | '1year' | 'custom';

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
  const { activeCategories, getCategoryLabel, getCategoryColor } = useCategoryContext();

  // 지출 수정 모달 상태
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editMemo, setEditMemo] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [rememberMerchant, setRememberMerchant] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const handleCategoryClick = (category: Category, categoryExpenses: Expense[]) => {
    setSelectedCategory(category);
    // 날짜 내림차순 정렬
    setSelectedCategoryExpenses(
      [...categoryExpenses].sort((a, b) => b.date.localeCompare(a.date))
    );
  };

  // 지출 수정 모달 열기
  const handleOpenEdit = (expense: Expense) => {
    setEditingExpense(expense);
    setEditAmount(expense.amount.toString());
    setEditMemo(expense.memo || '');
    setEditCategory(expense.category);
    setRememberMerchant(false);
  };

  // 지출 수정 저장
  const handleSaveEdit = async () => {
    if (!editingExpense) return;

    const newAmount = parseInt(editAmount, 10);
    if (isNaN(newAmount) || newAmount <= 0) return;

    const updates: { amount?: number; memo?: string; category?: string } = {};

    if (newAmount !== editingExpense.amount) {
      updates.amount = newAmount;
    }
    if (editMemo !== (editingExpense.memo || '')) {
      updates.memo = editMemo;
    }
    if (editCategory !== editingExpense.category) {
      updates.category = editCategory;
    }

    if (Object.keys(updates).length > 0) {
      try {
        await updateExpense(editingExpense.id, updates);

        // 카테고리가 변경되었고 기억하기 체크했으면 규칙 저장
        if (editCategory !== editingExpense.category && rememberMerchant) {
          const householdId = getStoredHouseholdKey() || 'guest';
          await addMerchantRule(householdId, editingExpense.merchant, editCategory, true);
        }

        // 카테고리가 변경되면 현재 모달의 리스트에서 제거
        if (editCategory !== editingExpense.category) {
          setSelectedCategoryExpenses(prev =>
            prev.filter(e => e.id !== editingExpense.id)
          );
        } else {
          // 카테고리가 같으면 리스트에서 해당 항목 업데이트
          setSelectedCategoryExpenses(prev =>
            prev.map(e => e.id === editingExpense.id
              ? { ...e, ...updates }
              : e
            )
          );
        }
      } catch (error) {
        console.error('지출 수정 실패:', error);
      }
    }

    setEditingExpense(null);
  };

  // 지출 삭제
  const handleDeleteExpense = async () => {
    if (!editingExpense) return;

    try {
      await deleteExpense(editingExpense.id);
      // 리스트에서 제거
      setSelectedCategoryExpenses(prev =>
        prev.filter(e => e.id !== editingExpense.id)
      );
    } catch (error) {
      console.error('지출 삭제 실패:', error);
    }

    setShowDeleteDialog(false);
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
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-white/50 p-4">
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                onClick={() => setPeriodPreset('1month')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  periodPreset === '1month'
                    ? 'bg-blue-500 text-white shadow-md'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                이번달
              </button>
              <button
                onClick={() => setPeriodPreset('3months')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  periodPreset === '3months'
                    ? 'bg-blue-500 text-white shadow-md'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                3개월
              </button>
              <button
                onClick={() => setPeriodPreset('6months')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  periodPreset === '6months'
                    ? 'bg-blue-500 text-white shadow-md'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                6개월
              </button>
              <button
                onClick={() => setPeriodPreset('1year')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  periodPreset === '1year'
                    ? 'bg-blue-500 text-white shadow-md'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                1년
              </button>
              <button
                onClick={() => setPeriodPreset('custom')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  periodPreset === 'custom'
                    ? 'bg-blue-500 text-white shadow-md'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                직접 선택
              </button>
            </div>

            {/* 직접 선택 시 날짜 입력 */}
            {periodPreset === 'custom' && (
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                <input
                  type="month"
                  value={customStartDate ? customStartDate.substring(0, 7) : ''}
                  onChange={(e) => setCustomStartDate(e.target.value ? `${e.target.value}-01` : '')}
                  className="px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-slate-400">~</span>
                <input
                  type="month"
                  value={customEndDate ? customEndDate.substring(0, 7) : ''}
                  onChange={(e) => {
                    if (e.target.value) {
                      const [year, month] = e.target.value.split('-');
                      const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
                      setCustomEndDate(`${e.target.value}-${lastDay}`);
                    } else {
                      setCustomEndDate('');
                    }
                  }}
                  className="px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}

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
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-white/50 p-6">
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
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-white/50 p-6">
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
        <div
          className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedCategory(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 모달 헤더 */}
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-medium"
                  style={{ backgroundColor: getCategoryColor(selectedCategory) }}
                >
                  {getCategoryLabel(selectedCategory).slice(0, 2)}
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-800">
                    {getCategoryLabel(selectedCategory)}
                  </h3>
                  <p className="text-sm text-slate-500">
                    {selectedCategoryExpenses.length}건 · {selectedCategoryExpenses.reduce((sum, e) => sum + e.amount, 0).toLocaleString()}원
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedCategory(null)}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 지출 내역 리스트 */}
            <div className="overflow-y-auto max-h-[60vh] p-4">
              <div className="space-y-2">
                {selectedCategoryExpenses.map((expense) => (
                  <div
                    key={expense.id}
                    onClick={() => handleOpenEdit(expense)}
                    className="flex items-center justify-between p-3 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-800 truncate">
                        {expense.merchant}
                      </div>
                      <div className="text-xs text-slate-500">
                        {expense.date}
                        {expense.memo && ` · ${expense.memo}`}
                      </div>
                    </div>
                    <div className="font-semibold text-slate-800 flex-shrink-0 ml-3">
                      {expense.amount.toLocaleString()}원
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 지출 수정 모달 */}
      {editingExpense && !showDeleteDialog && (
        <div
          className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center z-[60] p-4"
          onClick={() => setEditingExpense(null)}
        >
          <div
            className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-slate-800 mb-4">
              지출 수정
            </h3>

            <div className="space-y-4">
              {/* 가맹점명 (읽기 전용) */}
              <div>
                <label className="block text-sm font-medium text-slate-500 mb-1">
                  가맹점
                </label>
                <div className="px-3 py-2 bg-slate-100 rounded-lg text-slate-700">
                  {editingExpense.merchant}
                </div>
              </div>

              {/* 날짜 (읽기 전용) */}
              <div>
                <label className="block text-sm font-medium text-slate-500 mb-1">
                  날짜
                </label>
                <div className="px-3 py-2 bg-slate-100 rounded-lg text-slate-700">
                  {editingExpense.date}
                </div>
              </div>

              {/* 금액 */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  금액
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={editAmount}
                    onChange={(e) => setEditAmount(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 pr-10"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                    원
                  </span>
                </div>
              </div>

              {/* 카테고리 */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  카테고리
                </label>
                <div className="flex flex-wrap gap-2">
                  {activeCategories.map((cat) => (
                    <button
                      key={cat.key}
                      type="button"
                      onClick={() => setEditCategory(cat.key)}
                      className={`flex flex-col items-center p-2 rounded-lg border-2 transition-colors min-w-[56px] ${
                        editCategory === cat.key
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div
                        className="w-6 h-6 rounded-full mb-1"
                        style={{ backgroundColor: cat.color }}
                      />
                      <span className="text-xs text-slate-700">
                        {cat.label.slice(0, 2)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 메모 */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  메모
                </label>
                <input
                  type="text"
                  value={editMemo}
                  onChange={(e) => setEditMemo(e.target.value)}
                  placeholder="메모 입력 (선택)"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* 가맹점 기억하기 (카테고리 변경시에만 표시) */}
              {editCategory !== editingExpense.category && (
                <label className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rememberMerchant}
                    onChange={(e) => setRememberMerchant(e.target.checked)}
                    className="w-4 h-4 text-blue-500 rounded focus:ring-blue-500"
                  />
                  <div>
                    <span className="text-sm font-medium text-slate-700">
                      이 가맹점 기억하기
                    </span>
                    <p className="text-xs text-slate-500">
                      다음에 &quot;{editingExpense.merchant}&quot;에서 결제하면 자동으로 {getCategoryLabel(editCategory)}(으)로 분류
                    </p>
                  </div>
                </label>
              )}
            </div>

            {/* 삭제 버튼 */}
            <button
              onClick={() => setShowDeleteDialog(true)}
              className="w-full py-2 px-4 border border-red-300 text-red-500 rounded-lg hover:bg-red-50 transition-colors mt-4"
            >
              삭제
            </button>

            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setEditingExpense(null)}
                className="flex-1 py-2 px-4 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleSaveEdit}
                className="flex-1 py-2 px-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 삭제 확인 다이얼로그 */}
      {showDeleteDialog && editingExpense && (
        <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center z-[70]">
          <div className="bg-white rounded-2xl p-6 m-4 max-w-sm w-full shadow-xl">
            <h3 className="text-lg font-semibold text-slate-800 mb-3">
              삭제 확인
            </h3>
            <p className="text-slate-600 mb-6">
              &quot;{editingExpense.merchant}&quot; {editingExpense.amount.toLocaleString()}원을 삭제하시겠습니까?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteDialog(false)}
                className="flex-1 py-2 px-4 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleDeleteExpense}
                className="flex-1 py-2 px-4 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
