'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import DonutChart from '@/components/DonutChart';
import MonthlyTrendChart from '@/components/MonthlyTrendChart';
import { Expense, Category } from '@/types/expense';
import { subscribeToDateRangeExpenses } from '@/lib/expenseService';
import { useCategoryContext } from '@/contexts/CategoryContext';

// 기간 프리셋
type PeriodPreset = '3months' | '6months' | '1year' | 'custom';

export default function StatsPage() {
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('6months');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // 카테고리 상세 모달 상태
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [selectedCategoryExpenses, setSelectedCategoryExpenses] = useState<Expense[]>([]);
  const { getCategoryLabel, getCategoryColor } = useCategoryContext();

  const handleCategoryClick = (category: Category, categoryExpenses: Expense[]) => {
    setSelectedCategory(category);
    // 날짜 내림차순 정렬
    setSelectedCategoryExpenses(
      [...categoryExpenses].sort((a, b) => b.date.localeCompare(a.date))
    );
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
        start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
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

  // 총 지출
  const totalAmount = expenses.reduce((sum, e) => sum + e.amount, 0);

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
              <div className="flex items-baseline gap-1">
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
              />
            ) : (
              <div className="h-72 flex items-center justify-center text-slate-400">
                데이터 없음
              </div>
            )}
          </div>

          {/* 도넛 차트 - 해당 기간 전체 */}
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-white/50 p-6">
            <h3 className="text-lg font-semibold text-slate-700 mb-4">
              카테고리별 비율
            </h3>
            <div className="min-h-64">
              {expenses.length > 0 ? (
                <DonutChart expenses={expenses} onCategoryClick={handleCategoryClick} />
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
                    className="flex items-center justify-between p-3 bg-slate-50 rounded-xl"
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
    </main>
  );
}
