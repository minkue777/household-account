'use client';

import { useState, useMemo, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Calendar from '@/components/Calendar';
import CategorySummary from '@/components/CategorySummary';
import { ExpenseDetail, AddExpenseModal } from '@/components/expense';
import { SearchModal } from '@/components/search';
import { Expense, Category } from '@/types/expense';
import { DEFAULT_HOME_SUMMARY_CONFIG } from '@/types/household';
import BalanceCards from '@/components/BalanceCards';
import HomeHeader from '@/components/HomeHeader';
import CategoryDetailModal from '@/components/CategoryDetailModal';
import LocalCurrencyModal from '@/components/LocalCurrencyModal';
import { subscribeToMonthlyExpenses, subscribeToDateRangeExpenses, updateExpense, addManualExpense, deleteExpense, splitExpense, mergeExpenses, unmergeExpense, SplitItem, generateSplitGroupId, addExpense } from '@/lib/expenseService';
import { addMerchantRule } from '@/lib/merchantRuleService';
import { getStoredHouseholdKey } from '@/lib/householdService';
import { processRecurringExpenses } from '@/lib/recurringExpenseService';
import { getMonthlySplitDate } from '@/lib/utils/monthlySplitDate';
import { useHousehold } from '@/contexts/HouseholdContext';

export default function Home() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { household, householdKey } = useHousehold();

  const [currentYear, setCurrentYear] = useState(() => new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(() => new Date().getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [yearlySpent, setYearlySpent] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null);
  const [editExpenseId, setEditExpenseId] = useState<string | null>(null);

  // 카테고리 상세 모달 상태
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [selectedCategoryExpenses, setSelectedCategoryExpenses] = useState<Expense[]>([]);

  // 지역화폐 지출 모달 상태
  const [showLocalCurrencyModal, setShowLocalCurrencyModal] = useState(false);
  const [localCurrencyExpenses, setLocalCurrencyExpenses] = useState<Expense[]>([]);
  const homeSummaryConfig = household?.homeSummaryConfig || DEFAULT_HOME_SUMMARY_CONFIG;
  const needsYearlySpent =
    homeSummaryConfig.leftCard === 'yearlySpent' || homeSummaryConfig.rightCard === 'yearlySpent';

  // 정기 지출 자동 등록 (앱 로드 시 한 번만)
  useEffect(() => {
    if (!householdKey) {
      return;
    }

    processRecurringExpenses(householdKey).then((count) => {
      if (count > 0) {
      }
    });
  }, [householdKey]);

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

  useEffect(() => {
    if (!needsYearlySpent) {
      setYearlySpent(null);
      return undefined;
    }

    const startDate = `${currentYear}-01-01`;
    const endDate = `${currentYear}-12-31`;

    const unsubscribe = subscribeToDateRangeExpenses(startDate, endDate, (yearExpenses) => {
      setYearlySpent(yearExpenses.reduce((sum, expense) => sum + expense.amount, 0));
    });

    return () => unsubscribe();
  }, [currentYear, needsYearlySpent]);

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
        const splitGroupId = generateSplitGroupId();

        for (let i = 0; i < splitMonths; i++) {
          const dateStr = getMonthlySplitDate(date, i);

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
          }, {
            notifyOnCreate: false,
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
        <HomeHeader onSearchClick={() => setShowSearchModal(true)} />

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

        {/* 잔액 요약 카드 - 모바일 */}
        <BalanceCards
          currentYear={currentYear}
          currentMonth={currentMonth}
          expenses={expenses}
          yearlySpent={yearlySpent}
          summaryConfig={homeSummaryConfig}
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
          <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-200/70 p-6 transition-all hover:shadow-md">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">
              카테고리별 지출
            </h3>
            {expenses.length > 0 ? (
              <CategorySummary expenses={expenses} onCategoryClick={handleCategoryClick} />
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
            <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-200/70 p-6 transition-all hover:shadow-md">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">
                카테고리별 지출
              </h3>
              {expenses.length > 0 ? (
                <CategorySummary expenses={expenses} onCategoryClick={handleCategoryClick} />
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
              currentYear={currentYear}
              currentMonth={currentMonth}
              expenses={expenses}
              yearlySpent={yearlySpent}
              summaryConfig={homeSummaryConfig}
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
        <CategoryDetailModal
          category={selectedCategory}
          expenses={selectedCategoryExpenses}
          currentMonth={currentMonth}
          onClose={() => setSelectedCategory(null)}
        />
      )}

      {/* 지역화폐 지출 내역 모달 */}
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
