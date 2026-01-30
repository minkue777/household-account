'use client';

import { useState, useMemo, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Calendar from '@/components/Calendar';
import CategorySummary from '@/components/CategorySummary';
import ExpenseDetail from '@/components/ExpenseDetail';
import AddExpenseModal from '@/components/AddExpenseModal';
import SearchModal from '@/components/SearchModal';
import BudgetTransferModal from '@/components/BudgetTransferModal';
import Portal from '@/components/Portal';
import { Expense, Category } from '@/types/expense';
import BalanceCards from '@/components/BalanceCards';
import { subscribeToMonthlyExpenses, updateExpense, addManualExpense, deleteExpense, splitExpense, mergeExpenses, unmergeExpense, SplitItem, generateSplitGroupId, addExpense } from '@/lib/expenseService';
import { addMerchantRule } from '@/lib/merchantRuleService';
import { subscribeToMonthlyBudgetTransfers, calculateBudgetAdjustments, BudgetTransfer } from '@/lib/budgetTransferService';
import { getStoredHouseholdKey } from '@/lib/householdService';
import { processRecurringExpenses } from '@/lib/recurringExpenseService';
import { useTheme } from '@/contexts/ThemeContext';
import { useCategoryContext } from '@/contexts/CategoryContext';

export default function Home() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [currentYear, setCurrentYear] = useState(2026);
  const [currentMonth, setCurrentMonth] = useState(1);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [showBudgetTransferModal, setShowBudgetTransferModal] = useState(false);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null);
  const [budgetTransfers, setBudgetTransfers] = useState<BudgetTransfer[]>([]);
  const [editExpenseId, setEditExpenseId] = useState<string | null>(null);
  const { themeConfig } = useTheme();
  const { getCategoryLabel, getCategoryColor, getCategoryBudget } = useCategoryContext();

  // 카테고리 상세 모달 상태
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [selectedCategoryExpenses, setSelectedCategoryExpenses] = useState<Expense[]>([]);

  // 지역화폐 지출 모달 상태
  const [showLocalCurrencyModal, setShowLocalCurrencyModal] = useState(false);
  const [localCurrencyExpenses, setLocalCurrencyExpenses] = useState<Expense[]>([]);

  // 정기 지출 자동 등록 (앱 로드 시 한 번만)
  useEffect(() => {
    const householdId = getStoredHouseholdKey();
    if (householdId) {
      processRecurringExpenses(householdId).then((count) => {
        if (count > 0) {
        }
      });
    }
  }, []);

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

  // 예산 이동 구독
  useEffect(() => {
    const householdId = getStoredHouseholdKey() || 'guest';
    const yearMonth = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
    const unsubscribe = subscribeToMonthlyBudgetTransfers(householdId, yearMonth, setBudgetTransfers);
    return () => unsubscribe();
  }, [currentYear, currentMonth]);

  // URL에서 edit 파라미터 처리 (푸시 알림 클릭 시)
  useEffect(() => {
    const editId = searchParams.get('edit');
    if (editId) {
      setEditExpenseId(editId);
      // URL에서 edit 파라미터 제거
      router.replace('/', { scroll: false });
    }
  }, [searchParams, router]);

  // 자동 편집할 expense ID (ExpenseDetail에 전달)
  const [autoEditExpenseId, setAutoEditExpenseId] = useState<string | null>(null);

  // 편집할 지출 찾아서 해당 날짜로 이동
  useEffect(() => {
    if (editExpenseId && expenses.length > 0) {
      const expense = expenses.find(e => e.id === editExpenseId);
      if (expense) {
        // 해당 지출의 날짜 선택하고 자동 편집 모달 열기
        setSelectedDate(expense.date);
        setAutoEditExpenseId(editExpenseId);
        setEditExpenseId(null);
      } else {
        // 현재 월에 없으면 전체 검색 필요 - 일단 검색 모달 열기
        setShowSearchModal(true);
        setEditExpenseId(null);
      }
    }
  }, [editExpenseId, expenses]);

  // 예산 조정값 계산
  const budgetAdjustments = useMemo(() => {
    return calculateBudgetAdjustments(budgetTransfers);
  }, [budgetTransfers]);

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

  // 년/월 직접 선택 핸들러
  const handleYearMonthChange = (newYear: number, newMonth: number) => {
    setCurrentYear(newYear);
    setCurrentMonth(newMonth);
    setSelectedDate(null);
  };

  // 카테고리 클릭 핸들러
  const handleCategoryClick = (category: Category, categoryExpenses: Expense[]) => {
    setSelectedCategory(category);
    // 날짜 내림차순 정렬
    setSelectedCategoryExpenses(
      [...categoryExpenses].sort((a, b) => b.date.localeCompare(a.date))
    );
  };

  // 지역화폐 지출 클릭 핸들러
  const handleLocalCurrencyClick = (expenses: Expense[]) => {
    setLocalCurrencyExpenses(
      [...expenses].sort((a, b) => b.date.localeCompare(a.date))
    );
    setShowLocalCurrencyModal(true);
  };

  // 지출 수정 핸들러
  const handleExpenseUpdate = async (expenseId: string, data: { amount?: number; memo?: string; category?: string }) => {
    try {
      await updateExpense(expenseId, data);
    } catch (error) {
    }
  };

  // 가맹점 규칙 저장 핸들러
  const handleSaveMerchantRule = async (merchantName: string, category: string) => {
    try {
      const householdId = getStoredHouseholdKey() || 'guest';
      console.log('가맹점 규칙 저장 시도:', { householdId, merchantName, category });
      const ruleId = await addMerchantRule(householdId, merchantName, category, true);
      if (ruleId) {
        console.log('가맹점 규칙 저장 성공:', ruleId);
      } else {
        console.log('가맹점 규칙 저장 실패 또는 이미 존재');
      }
    } catch (error) {
      console.error('가맹점 규칙 저장 오류:', error);
    }
  };

  // 수동 지출 추가 핸들러
  const handleAddExpense = async (merchant: string, amount: number, category: string, date: string, memo?: string, splitMonths?: number) => {
    try {
      if (splitMonths && splitMonths > 1) {
        // 월별 분할: n개월에 걸쳐 등록 (그룹 ID로 연결)
        const monthlyAmount = Math.floor(amount / splitMonths);
        const baseDate = new Date(date);
        const splitGroupId = generateSplitGroupId();

        for (let i = 0; i < splitMonths; i++) {
          const targetDate = new Date(baseDate);
          targetDate.setMonth(targetDate.getMonth() + i);
          const dateStr = targetDate.toISOString().split('T')[0];

          await addExpense({
            date: dateStr,
            time: '09:00',
            merchant: `${merchant} (${i + 1}/${splitMonths})`,
            amount: monthlyAmount,
            category,
            cardType: 'main',
            splitGroupId,
            splitIndex: i + 1,
            splitTotal: splitMonths,
          });
        }
      } else {
        await addManualExpense(merchant, amount, category, date, memo);
      }
    } catch (error) {
    }
  };

  // 지출 삭제 핸들러
  const handleDeleteExpense = async (expenseId: string) => {
    try {
      await deleteExpense(expenseId);
    } catch (error) {
    }
  };

  // 지출 분할 핸들러
  const handleSplitExpense = async (expense: Expense, splits: SplitItem[]) => {
    try {
      await splitExpense(expense, splits);
    } catch (error) {
    }
  };

  // 지출 합치기 핸들러
  const handleMergeExpenses = async (targetExpense: Expense, sourceExpense: Expense) => {
    try {
      await mergeExpenses(targetExpense, sourceExpense);
    } catch (error) {
    }
  };

  // 합치기 되돌리기 핸들러
  const handleUnmergeExpense = async (expense: Expense) => {
    try {
      await unmergeExpense(expense);
    } catch (error) {
    }
  };

  return (
    <main className="min-h-screen p-4 md:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        {/* 헤더 */}
        <header className="mb-6 flex items-center justify-between">
          {/* 왼쪽: 제목 + 곰돌이 (클릭 시 자산 페이지로 이동) */}
          <Link href="/assets" className="flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer">
            <h1
              className="text-lg md:text-2xl font-bold leading-tight"
              style={{
                background: themeConfig.titleGradient,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              또니망고네
              <br />
              가계부
            </h1>
            <img
              src="/bear-removebg-preview.png"
              alt="곰돌이"
              className="w-14 h-14 md:w-16 md:h-16 object-contain"
            />
          </Link>

          {/* 오른쪽: 버튼들 */}
          <div className="flex items-center gap-1.5 md:gap-2 flex-shrink-0">
            <button
              onClick={() => setShowSearchModal(true)}
              className="bg-white/80 hover:bg-white text-slate-600 p-2 md:px-4 md:py-2 rounded-xl flex items-center gap-2 transition-all shadow-sm hover:shadow border border-slate-200/50"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span className="hidden md:inline">검색</span>
            </button>
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

        {/* 검색 모달 */}
        <SearchModal
          isOpen={showSearchModal}
          onClose={() => setShowSearchModal(false)}
          onExpenseUpdate={handleExpenseUpdate}
          onDelete={handleDeleteExpense}
          onSplitExpense={handleSplitExpense}
        />

        {/* 예산 조정 모달 */}
        <BudgetTransferModal
          isOpen={showBudgetTransferModal}
          onClose={() => setShowBudgetTransferModal(false)}
          year={currentYear}
          month={currentMonth}
        />

        {/* 잔액 요약 카드 - 모바일 */}
        <BalanceCards
          currentMonth={currentMonth}
          expenses={expenses}
          className="lg:hidden mb-4"
          onLocalCurrencyClick={handleLocalCurrencyClick}
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
              onYearMonthChange={handleYearMonthChange}
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
              onSplitExpense={handleSplitExpense}
              onMergeExpenses={handleMergeExpenses}
              onUnmergeExpense={handleUnmergeExpense}
              autoEditExpenseId={autoEditExpenseId}
              onAutoEditHandled={() => setAutoEditExpenseId(null)}
            />
          )}

          {/* 카테고리별 지출 - 맨 아래 */}
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-white/50 p-6 transition-all hover:shadow-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-700">
                카테고리별 지출
              </h3>
              <button
                onClick={() => setShowBudgetTransferModal(true)}
                className="text-xs text-blue-500 hover:text-blue-600 flex items-center gap-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
                예산 조정
              </button>
            </div>
            {expenses.length > 0 ? (
              <CategorySummary expenses={expenses} onCategoryClick={handleCategoryClick} budgetAdjustments={budgetAdjustments} />
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
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-700">
                  카테고리별 지출
                </h3>
                <button
                  onClick={() => setShowBudgetTransferModal(true)}
                  className="text-xs text-blue-500 hover:text-blue-600 flex items-center gap-1"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                  </svg>
                  예산 조정
                </button>
              </div>
              {expenses.length > 0 ? (
                <CategorySummary expenses={expenses} onCategoryClick={handleCategoryClick} budgetAdjustments={budgetAdjustments} />
              ) : (
                <div className="text-center py-4 text-slate-400">
                  {isLoading ? '로딩중...' : '데이터 없음'}
                </div>
              )}
            </div>
          </div>

          {/* 오른쪽 메인 */}
          <div className="lg:col-span-3 space-y-6">
            {/* 잔액 요약 카드 - 데스크톱 */}
            <BalanceCards
              currentMonth={currentMonth}
              expenses={expenses}
              onLocalCurrencyClick={handleLocalCurrencyClick}
            />

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
                onYearMonthChange={handleYearMonthChange}
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

      {/* 카테고리 지출 내역 모달 */}
      {selectedCategory && (
        <Portal>
          <div
            className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm flex items-center justify-center z-[9999] p-4"
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
                    {(() => {
                      const total = selectedCategoryExpenses.reduce((sum, e) => sum + e.amount, 0);
                      const originalBudget = getCategoryBudget(selectedCategory);
                      const adjustment = budgetAdjustments[selectedCategory] || 0;
                      const budget = originalBudget !== null ? originalBudget + adjustment : null;
                      const hasBudget = budget !== null && budget > 0;
                      const percentage = hasBudget ? Math.round((total / budget) * 100) : 0;
                      const isOverBudget = hasBudget && total > budget;

                      return (
                        <div className="text-sm text-slate-500">
                          <p>{currentMonth}월 · {selectedCategoryExpenses.length}건</p>
                          <p className={isOverBudget ? 'text-red-500 font-medium' : ''}>
                            {total.toLocaleString()}
                            {hasBudget ? ` / ${budget.toLocaleString()}원 (${percentage}%)` : '원'}
                            {adjustment !== 0 && (
                              <span className={`ml-1 ${adjustment > 0 ? 'text-green-500' : 'text-orange-500'}`}>
                                ({adjustment > 0 ? '+' : ''}{adjustment.toLocaleString()})
                              </span>
                            )}
                          </p>
                        </div>
                      );
                    })()}
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
        </Portal>
      )}

      {/* 지역화폐 지출 내역 모달 */}
      {showLocalCurrencyModal && (
        <Portal>
          <div
            className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm flex items-center justify-center z-[9999] p-4"
            onClick={() => setShowLocalCurrencyModal(false)}
          >
            <div
              className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* 모달 헤더 */}
              <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center bg-blue-100 text-blue-600">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-800">
                      경기지역화폐
                    </h3>
                    <div className="text-sm text-slate-500">
                      <p>{currentMonth}월 · {localCurrencyExpenses.length}건</p>
                      <p>{localCurrencyExpenses.reduce((sum, e) => sum + e.amount, 0).toLocaleString()}원</p>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setShowLocalCurrencyModal(false)}
                  className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* 지출 내역 리스트 */}
              <div className="overflow-y-auto max-h-[60vh] p-4">
                {localCurrencyExpenses.length === 0 ? (
                  <div className="text-center py-8 text-slate-400">
                    이번 달 경기지역화폐 지출 내역이 없습니다.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {localCurrencyExpenses.map((expense) => (
                      <div
                        key={expense.id}
                        className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl cursor-pointer hover:bg-slate-100 transition-colors"
                        onClick={() => {
                          setShowLocalCurrencyModal(false);
                          setSelectedDate(expense.date);
                          setEditExpenseId(expense.id);
                        }}
                      >
                        {/* 카테고리 뱃지 */}
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0"
                          style={{ backgroundColor: getCategoryColor(expense.category) }}
                        >
                          {getCategoryLabel(expense.category).slice(0, 2)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-slate-800 truncate">
                            {expense.merchant}
                          </div>
                          <div className="text-xs text-slate-500">
                            {expense.date}
                            {expense.memo && ` · ${expense.memo}`}
                          </div>
                        </div>
                        <div className="font-semibold text-slate-800 flex-shrink-0">
                          {expense.amount.toLocaleString()}원
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </Portal>
      )}
    </main>
  );
}
