'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import DonutChart from '@/components/DonutChart';
import CategorySummary from '@/components/CategorySummary';
import MonthSelector from '@/components/MonthSelector';
import { Expense } from '@/types/expense';
import { subscribeToMonthlyExpenses } from '@/lib/expenseService';

export default function StatsPage() {
  const [currentYear, setCurrentYear] = useState(2026);
  const [currentMonth, setCurrentMonth] = useState(1);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Firebase 실시간 구독
  useEffect(() => {
    setIsLoading(true);

    const unsubscribe = subscribeToMonthlyExpenses(
      currentYear,
      currentMonth,
      (newExpenses) => {
        setExpenses(newExpenses);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [currentYear, currentMonth]);

  // 이전/다음 달 이동
  const handlePrevMonth = () => {
    if (currentMonth === 1) {
      setCurrentYear(currentYear - 1);
      setCurrentMonth(12);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 12) {
      setCurrentYear(currentYear + 1);
      setCurrentMonth(1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  // 월 총액
  const monthlyTotal = expenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <main className="min-h-screen p-4 md:p-6 lg:p-8">
      <div className="max-w-3xl mx-auto">
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
          {/* 월 선택 & 총액 */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <MonthSelector
              year={currentYear}
              month={currentMonth}
              onPrevMonth={handlePrevMonth}
              onNextMonth={handleNextMonth}
            />
            <div className="mt-4 pt-4 border-t border-slate-100">
              <div className="text-sm text-slate-500">이번 달 총 지출</div>
              <div className="text-3xl font-bold text-slate-800">
                {isLoading ? (
                  <span className="text-slate-400">로딩중...</span>
                ) : (
                  <>
                    {monthlyTotal.toLocaleString()}
                    <span className="text-lg font-normal text-slate-500">원</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* 도넛 차트 */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-lg font-semibold text-slate-700 mb-4">
              카테고리별 지출
            </h3>
            <div className="h-64">
              {expenses.length > 0 ? (
                <DonutChart expenses={expenses} />
              ) : (
                <div className="h-full flex items-center justify-center text-slate-400">
                  {isLoading ? '로딩중...' : '데이터 없음'}
                </div>
              )}
            </div>
          </div>

          {/* 카테고리 요약 */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-lg font-semibold text-slate-700 mb-4">
              상세 내역
            </h3>
            {expenses.length > 0 ? (
              <CategorySummary expenses={expenses} />
            ) : (
              <div className="text-center py-8 text-slate-400">
                {isLoading ? '로딩중...' : '데이터 없음'}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
