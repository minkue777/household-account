'use client';

import { useMemo, useState } from 'react';
import { Expense } from '@/types/expense';
import { useCategoryContext } from '@/contexts/CategoryContext';
import { Portal } from './common';
import { getTodayLocalDate } from '@/lib/utils/date';

interface CalendarProps {
  year: number;
  month: number;
  expenses: Expense[];
  onDateClick: (date: string) => void;
  selectedDate: string | null;
  onPrevMonth?: () => void;
  onNextMonth?: () => void;
  monthlyTotal?: number;
  isLoading?: boolean;
  onYearMonthChange?: (year: number, month: number) => void;
}

const DAYS_OF_WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const DAY_COLORS = [
  'text-red-500',    // 일요일
  'text-slate-700',  // 월
  'text-slate-700',  // 화
  'text-slate-700',  // 수
  'text-slate-700',  // 목
  'text-slate-700',  // 금
  'text-blue-500',   // 토요일
];

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export default function Calendar({
  year,
  month,
  expenses,
  onDateClick,
  selectedDate,
  onPrevMonth,
  onNextMonth,
  monthlyTotal,
  isLoading,
  onYearMonthChange,
}: CalendarProps) {
  const { getCategoryColor } = useCategoryContext();
  const [showYearMonthPicker, setShowYearMonthPicker] = useState(false);
  const [pickerYear, setPickerYear] = useState(year);

  // 해당 월의 일수와 시작 요일 계산
  const { daysInMonth, startDay, dates } = useMemo(() => {
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const daysInMonth = lastDay.getDate();
    const startDay = firstDay.getDay();

    const dates: (number | null)[] = [];

    // 시작 전 빈 칸
    for (let i = 0; i < startDay; i++) {
      dates.push(null);
    }

    // 날짜 채우기
    for (let i = 1; i <= daysInMonth; i++) {
      dates.push(i);
    }

    return { daysInMonth, startDay, dates };
  }, [year, month]);

  // 날짜별 지출 그룹핑
  const expensesByDate = useMemo(() => {
    const grouped = new Map<string, Expense[]>();
    expenses.forEach((expense) => {
      const existing = grouped.get(expense.date) || [];
      grouped.set(expense.date, [...existing, expense]);
    });
    return grouped;
  }, [expenses]);

  // 날짜 문자열 생성
  const formatDate = (day: number) => {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  // 날짜별 총액 계산
  const getDayTotal = (day: number) => {
    const dateStr = formatDate(day);
    const dayExpenses = expensesByDate.get(dateStr) || [];
    return dayExpenses.reduce((sum, e) => sum + e.amount, 0);
  };

  // 날짜별 지출 항목 (최대 3개까지 표시)
  const getDayExpenses = (day: number) => {
    const dateStr = formatDate(day);
    return expensesByDate.get(dateStr) || [];
  };

  // 년/월 선택 핸들러
  const handleYearMonthSelect = (selectedMonth: number) => {
    if (onYearMonthChange) {
      onYearMonthChange(pickerYear, selectedMonth);
    } else {
      // onYearMonthChange가 없으면 기존 방식으로 월 이동
      const monthDiff = (pickerYear - year) * 12 + (selectedMonth - month);
      if (monthDiff > 0) {
        for (let i = 0; i < monthDiff; i++) {
          onNextMonth?.();
        }
      } else if (monthDiff < 0) {
        for (let i = 0; i < Math.abs(monthDiff); i++) {
          onPrevMonth?.();
        }
      }
    }
    setShowYearMonthPicker(false);
  };

  return (
    <div className="calendar-glass overflow-hidden">
      {/* 월 선택 헤더 */}
      {onPrevMonth && onNextMonth && (
        <div className="flex items-center justify-center px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              onClick={onPrevMonth}
              className="p-1.5 hover:bg-white/50 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={() => {
                setPickerYear(year);
                setShowYearMonthPicker(true);
              }}
              className="text-lg font-semibold text-slate-800 min-w-[120px] text-center hover:bg-white/50 rounded-lg px-2 py-1 transition-colors"
            >
              {year}년 {month}월
            </button>
            <button
              onClick={onNextMonth}
              className="p-1.5 hover:bg-white/50 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* 년/월 선택 모달 */}
      {showYearMonthPicker && (
        <Portal>
          <div
            className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-[9999] flex items-center justify-center p-4"
            onClick={() => setShowYearMonthPicker(false)}
          >
            <div
              className="bg-white rounded-2xl p-4 shadow-xl w-72"
              onClick={(e) => e.stopPropagation()}
            >
            {/* 년도 선택 */}
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => setPickerYear(pickerYear - 1)}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <span className="text-xl font-bold text-slate-800">{pickerYear}년</span>
              <button
                onClick={() => setPickerYear(pickerYear + 1)}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>

            {/* 월 선택 그리드 */}
            <div className="grid grid-cols-4 gap-2">
              {MONTHS.map((m) => (
                <button
                  key={m}
                  onClick={() => handleYearMonthSelect(m)}
                  className={`py-3 rounded-xl text-sm font-medium transition-colors ${
                    pickerYear === year && m === month
                      ? 'bg-blue-500 text-white'
                      : 'hover:bg-slate-100 text-slate-700'
                  }`}
                >
                  {m}월
                </button>
              ))}
            </div>

            {/* 오늘로 이동 버튼 */}
            <button
              onClick={() => {
                const today = new Date();
                if (onYearMonthChange) {
                  onYearMonthChange(today.getFullYear(), today.getMonth() + 1);
                }
                setShowYearMonthPicker(false);
              }}
              className="w-full mt-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm font-medium text-slate-700 transition-colors"
            >
              오늘로 이동
            </button>
            </div>
          </div>
        </Portal>
      )}

      {/* 요일 헤더 */}
      <div className="grid grid-cols-7 border-y border-slate-200/50">
        {DAYS_OF_WEEK.map((day, index) => (
          <div
            key={day}
            className={`py-3 text-center text-sm font-semibold ${DAY_COLORS[index]}`}
          >
            {day}
          </div>
        ))}
      </div>

      {/* 날짜 그리드 */}
      <div className="grid grid-cols-7 overflow-hidden rounded-b-2xl">
        {dates.map((day, index) => {
          if (day === null) {
            return <div key={`empty-${index}`} className="h-12 md:h-28 bg-slate-50/30 m-[1px] rounded-lg" />;
          }

          const dateStr = formatDate(day);
          const dayExpenses = getDayExpenses(day);
          const dayTotal = getDayTotal(day);
          const isSelected = selectedDate === dateStr;
          const dayOfWeek = (startDay + day - 1) % 7;
          const isToday = getTodayLocalDate() === dateStr;

          return (
            <div
              key={day}
              onClick={() => onDateClick(dateStr)}
              className={`h-12 md:h-28 p-0.5 md:p-1.5 cursor-pointer transition-all m-[1px] rounded-lg ${
                isSelected
                  ? 'bg-blue-50 ring-2 ring-blue-400/50 shadow-sm'
                  : 'hover:bg-slate-50/80'
              }`}
            >
              {/* 모바일: 날짜 + 금액만 세로 배치 */}
              <div className="md:hidden flex flex-col items-center pt-1 h-full">
                <span
                  className={`text-xs font-medium ${
                    isToday
                      ? 'bg-blue-500 text-white w-5 h-5 rounded-full flex items-center justify-center'
                      : DAY_COLORS[dayOfWeek]
                  }`}
                >
                  {day}
                </span>
                {dayTotal > 0 && (
                  <span className="text-[9px] text-slate-500 mt-0.5">
                    {dayTotal >= 10000 ? `${Math.floor(dayTotal / 10000)}만` : `${Math.floor(dayTotal / 1000)}천`}
                  </span>
                )}
              </div>

              {/* 데스크톱: 기존 레이아웃 */}
              <div className="hidden md:block">
                <div className="flex items-center justify-between mb-1">
                  <span
                    className={`text-sm font-medium ${
                      isToday
                        ? 'bg-blue-500 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs'
                        : DAY_COLORS[dayOfWeek]
                    }`}
                  >
                    {day}
                  </span>
                  {dayTotal > 0 && (
                    <span className="text-xs text-slate-500 font-medium">
                      {dayTotal.toLocaleString()}
                    </span>
                  )}
                </div>

                {/* 지출 항목들 */}
                <div className="space-y-0.5 overflow-hidden">
                  {dayExpenses.slice(0, 3).map((expense) => (
                    <div
                      key={expense.id}
                      className="flex items-center gap-1 text-xs truncate"
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: getCategoryColor(expense.category) }}
                      />
                      <span className="truncate text-slate-600">
                        {expense.merchant}
                      </span>
                    </div>
                  ))}
                  {dayExpenses.length > 3 && (
                    <div className="text-xs text-slate-400">
                      +{dayExpenses.length - 3}건
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
