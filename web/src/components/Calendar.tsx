'use client';

import { useMemo } from 'react';
import { Expense, CATEGORY_COLORS } from '@/types/expense';

interface CalendarProps {
  year: number;
  month: number;
  expenses: Expense[];
  onDateClick: (date: string) => void;
  selectedDate: string | null;
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

export default function Calendar({
  year,
  month,
  expenses,
  onDateClick,
  selectedDate,
}: CalendarProps) {
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

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      {/* 요일 헤더 */}
      <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-200">
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
      <div className="grid grid-cols-7">
        {dates.map((day, index) => {
          if (day === null) {
            return <div key={`empty-${index}`} className="h-16 md:h-28 bg-slate-50/50" />;
          }

          const dateStr = formatDate(day);
          const dayExpenses = getDayExpenses(day);
          const dayTotal = getDayTotal(day);
          const isSelected = selectedDate === dateStr;
          const dayOfWeek = (startDay + day - 1) % 7;
          const isToday =
            new Date().toISOString().slice(0, 10) === dateStr;

          return (
            <div
              key={day}
              onClick={() => onDateClick(dateStr)}
              className={`h-16 md:h-28 border-b border-r border-slate-100 p-1 md:p-1.5 cursor-pointer transition-colors hover:bg-slate-50 ${
                isSelected ? 'bg-blue-50 ring-2 ring-blue-400 ring-inset' : ''
              }`}
            >
              {/* 날짜 숫자 */}
              <div className="flex items-center justify-between mb-0.5 md:mb-1">
                <span
                  className={`text-xs md:text-sm font-medium ${
                    isToday
                      ? 'bg-blue-500 text-white w-5 h-5 md:w-6 md:h-6 rounded-full flex items-center justify-center text-xs'
                      : DAY_COLORS[dayOfWeek]
                  }`}
                >
                  {day}
                </span>
                {dayTotal > 0 && (
                  <span className="text-[10px] md:text-xs text-slate-500 font-medium">
                    {dayTotal >= 10000 ? `${Math.floor(dayTotal / 10000)}만` : dayTotal.toLocaleString()}
                  </span>
                )}
              </div>

              {/* 지출 항목들 - 모바일에서는 숨김 */}
              <div className="hidden md:block space-y-0.5 overflow-hidden">
                {dayExpenses.slice(0, 3).map((expense) => (
                  <div
                    key={expense.id}
                    className="flex items-center gap-1 text-xs truncate"
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: CATEGORY_COLORS[expense.category] }}
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
              {/* 모바일에서만 표시 - 지출이 있으면 점 표시 */}
              {dayExpenses.length > 0 && (
                <div className="flex md:hidden gap-0.5 justify-center mt-1">
                  {dayExpenses.slice(0, 3).map((expense) => (
                    <span
                      key={expense.id}
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: CATEGORY_COLORS[expense.category] }}
                    />
                  ))}
                  {dayExpenses.length > 3 && (
                    <span className="text-[8px] text-slate-400 ml-0.5">+{dayExpenses.length - 3}</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
