'use client';

import { useState, useMemo, useEffect } from 'react';
import Calendar from '@/components/Calendar';
import DonutChart from '@/components/DonutChart';
import CategorySummary from '@/components/CategorySummary';
import ExpenseDetail from '@/components/ExpenseDetail';
import MonthSelector from '@/components/MonthSelector';
import AddExpenseModal from '@/components/AddExpenseModal';
import { Expense } from '@/types/expense';
import { subscribeToMonthlyExpenses, updateCategory, addManualExpense, deleteExpense } from '@/lib/expenseService';
import { addMerchantRule } from '@/lib/merchantRuleService';

export default function Home() {
  const [currentYear, setCurrentYear] = useState(2026);
  const [currentMonth, setCurrentMonth] = useState(1);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

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
    if (currentMonth === 1) {
      setCurrentYear(currentYear - 1);
      setCurrentMonth(12);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
    setSelectedDate(null);
  };

  const handleNextMonth = () => {
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

  // 카테고리 변경 핸들러
  const handleCategoryChange = async (expenseId: string, category: string) => {
    try {
      await updateCategory(expenseId, category);
    } catch (error) {
      console.error('카테고리 업데이트 실패:', error);
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

  // 월 총액
  const monthlyTotal = expenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <main className="min-h-screen p-4 md:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        {/* 헤더 */}
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 mb-2">
              또니망고네 가계부
            </h1>
            <p className="text-slate-500">가족 지출을 한눈에 관리하세요</p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            추가
          </button>
        </header>

        {/* 수동 추가 모달 */}
        <AddExpenseModal
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          onAdd={handleAddExpense}
          selectedDate={selectedDate}
        />

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* 왼쪽: 요약 패널 (모바일에서는 캘린더 아래로) */}
          <div className="lg:col-span-1 space-y-6 order-2 lg:order-1">
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

            {/* 도넛 차트 (데스크톱에서만 표시) */}
            <div className="hidden lg:block bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">
                카테고리별 지출
              </h3>
              <div className="h-48">
                {expenses.length > 0 ? (
                  <DonutChart expenses={expenses} />
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-400">
                    {isLoading ? '로딩중...' : '데이터 없음'}
                  </div>
                )}
              </div>
            </div>

            {/* 카테고리 요약 (데스크톱에서만 표시) */}
            <div className="hidden lg:block bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">
                상세 내역
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

          {/* 오른쪽: 캘린더 & 상세 (모바일에서는 먼저 표시) */}
          <div className="lg:col-span-3 space-y-6 order-1 lg:order-2">
            {/* 캘린더 */}
            <Calendar
              year={currentYear}
              month={currentMonth}
              expenses={expenses}
              onDateClick={handleDateClick}
              selectedDate={selectedDate}
            />

            {/* 선택된 날짜 상세 */}
            {selectedDate && (
              <ExpenseDetail
                date={selectedDate}
                expenses={selectedDateExpenses}
                onCategoryChange={handleCategoryChange}
                onSaveMerchantRule={handleSaveMerchantRule}
                onDelete={handleDeleteExpense}
              />
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
