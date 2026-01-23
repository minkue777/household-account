'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import Calendar from '@/components/Calendar';
import CategorySummary from '@/components/CategorySummary';
import ExpenseDetail from '@/components/ExpenseDetail';
import AddExpenseModal from '@/components/AddExpenseModal';
import { Expense } from '@/types/expense';
import { subscribeToMonthlyExpenses, updateExpense, addManualExpense, deleteExpense } from '@/lib/expenseService';
import { addMerchantRule } from '@/lib/merchantRuleService';

export default function Home() {
  const [currentYear, setCurrentYear] = useState(2026);
  const [currentMonth, setCurrentMonth] = useState(1);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null);

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

  // 선택된 날짜의 지출
  const selectedDateExpenses = useMemo(() => {
    if (!selectedDate) return [];
    return expenses.filter((expense) => expense.date === selectedDate);
  }, [selectedDate, expenses]);

  // 이전/다음 달 이동
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

  // 날짜 클릭 핸들러
  const handleDateClick = (date: string) => {
    setSelectedDate(selectedDate === date ? null : date);
  };

  // 지출 수정 핸들러
  const handleExpenseUpdate = async (expenseId: string, data: { amount?: number; memo?: string; category?: string }) => {
    try {
      await updateExpense(expenseId, data);
    } catch (error) {
      console.error('지출 업데이트 실패:', error);
    }
  };

  // 가맹점 규칙 저장 핸들러
  const handleSaveMerchantRule = async (merchantName: string, category: string) => {
    try {
      const ruleId = await addMerchantRule(merchantName, category, true);
      if (ruleId) {
        console.log('규칙 저장 성공:', merchantName, '->', category);
      }
    } catch (error) {
      console.error('규칙 저장 실패:', error);
    }
  };

  // 수동 지출 추가 핸들러
  const handleAddExpense = async (merchant: string, amount: number, category: string, date: string) => {
    try {
      await addManualExpense(merchant, amount, category, date);
      console.log('지출 추가 성공:', merchant, amount);
    } catch (error) {
      console.error('지출 추가 실패:', error);
    }
  };

  // 지출 삭제 핸들러
  const handleDeleteExpense = async (expenseId: string) => {
    try {
      await deleteExpense(expenseId);
      console.log('지출 삭제 성공:', expenseId);
    } catch (error) {
      console.error('지출 삭제 실패:', error);
    }
  };

  return (
    <main className="min-h-screen p-4 md:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        {/* 헤더 */}
        <header className="mb-6 flex items-center justify-between">
          <div className="min-w-0 flex items-center gap-2">
            <div>
              <div className="flex items-center gap-1">
                <h1 className="text-lg md:text-2xl font-bold gradient-text truncate">
                  또니망고네 가계부
                </h1>
                <img
                  src="/bear-removebg-preview.png"
                  alt="곰돌이"
                  className="w-12 h-12 md:w-16 md:h-16 object-contain"
                />
              </div>
              <p className="text-slate-500 text-sm hidden md:block">우리 가족 지출을 한눈에!</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 md:gap-2 flex-shrink-0">
            <Link
              href="/settings"
              className="bg-white/80 hover:bg-white text-slate-600 p-2 md:px-4 md:py-2 rounded-xl flex items-center gap-2 transition-all shadow-sm hover:shadow border border-slate-200/50"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="hidden md:inline">설정</span>
            </Link>
            <Link
              href="/stats"
              className="bg-white/80 hover:bg-white text-slate-600 p-2 md:px-4 md:py-2 rounded-xl flex items-center gap-2 transition-all shadow-sm hover:shadow border border-slate-200/50"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <span className="hidden md:inline">통계</span>
            </Link>
          </div>
        </header>

        {/* 수동 추가 모달 */}
        <AddExpenseModal
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          onAdd={handleAddExpense}
          selectedDate={selectedDate}
        />

        {/* 모바일 레이아웃 */}
        <div className="lg:hidden space-y-6">
          {/* 캘린더 (월 선택 & 총액 통합) */}
          <div
            key={`${currentYear}-${currentMonth}`}
            className={slideDirection === 'left' ? 'animate-slideLeft' : slideDirection === 'right' ? 'animate-slideRight' : ''}
          >
            <Calendar
              year={currentYear}
              month={currentMonth}
              expenses={expenses}
              onDateClick={handleDateClick}
              selectedDate={selectedDate}
              onPrevMonth={handlePrevMonth}
              onNextMonth={handleNextMonth}
            />
          </div>

          {/* 선택된 날짜 상세 - 캘린더 바로 아래 */}
          {selectedDate && (
            <ExpenseDetail
              key={selectedDate}
              date={selectedDate}
              expenses={selectedDateExpenses}
              onExpenseUpdate={handleExpenseUpdate}
              onSaveMerchantRule={handleSaveMerchantRule}
              onDelete={handleDeleteExpense}
              onAddExpense={() => setShowAddModal(true)}
            />
          )}

          {/* 카테고리별 지출 - 맨 아래 */}
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-white/50 p-6 transition-all hover:shadow-md">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">
              카테고리별 지출
            </h3>
            {expenses.length > 0 ? (
              <CategorySummary expenses={expenses} />
            ) : (
              <div className="text-center py-4 text-slate-400">
                {isLoading ? '로딩중...' : '데이터 없음'}
              </div>
            )}
          </div>
        </div>

        {/* 데스크톱 레이아웃 */}
        <div className="hidden lg:grid lg:grid-cols-4 gap-6">
          {/* 왼쪽 사이드바 */}
          <div className="lg:col-span-1 space-y-6">
            {/* 카테고리별 지출 */}
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-white/50 p-6 transition-all hover:shadow-md">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">
                카테고리별 지출
              </h3>
              {expenses.length > 0 ? (
                <CategorySummary expenses={expenses} />
              ) : (
                <div className="text-center py-4 text-slate-400">
                  {isLoading ? '로딩중...' : '데이터 없음'}
                </div>
              )}
            </div>
          </div>

          {/* 오른쪽 메인 */}
          <div className="lg:col-span-3 space-y-6">
            {/* 캘린더 (월 선택 & 총액 통합) */}
            <div
              key={`desktop-${currentYear}-${currentMonth}`}
              className={slideDirection === 'left' ? 'animate-slideLeft' : slideDirection === 'right' ? 'animate-slideRight' : ''}
            >
              <Calendar
                year={currentYear}
                month={currentMonth}
                expenses={expenses}
                onDateClick={handleDateClick}
                selectedDate={selectedDate}
                onPrevMonth={handlePrevMonth}
                onNextMonth={handleNextMonth}
              />
            </div>

            {/* 선택된 날짜 상세 */}
            {selectedDate && (
              <ExpenseDetail
                key={selectedDate}
                date={selectedDate}
                expenses={selectedDateExpenses}
                onExpenseUpdate={handleExpenseUpdate}
                onSaveMerchantRule={handleSaveMerchantRule}
                onDelete={handleDeleteExpense}
                onAddExpense={() => setShowAddModal(true)}
              />
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
