'use client';

import { useMemo, useState } from 'react';
import { Expense } from '@/types/expense';
import { useCategoryContext } from '@/contexts/CategoryContext';
import { Portal } from './common';

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
  'text-red-500',
  'text-slate-700',
  'text-slate-700',
  'text-slate-700',
  'text-slate-700',
  'text-slate-700',
  'text-blue-500',
];
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function formatCompactAmount(amount: number): string {
  if (amount >= 10000) {
    const value = amount / 10000;
    return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, '')}만`;
  }

  if (amount >= 1000) {
    return `${Math.floor(amount / 1000)}천`;
  }

  return amount.toLocaleString();
}

export default function Calendar({
  year,
  month,
  expenses,
  onDateClick,
  selectedDate,
  onPrevMonth,
  onNextMonth,
  monthlyTotal,
  onYearMonthChange,
}: CalendarProps) {
  const { getCategoryColor } = useCategoryContext();
  const [showYearMonthPicker, setShowYearMonthPicker] = useState(false);
  const [pickerYear, setPickerYear] = useState(year);

  const { startDay, dates } = useMemo(() => {
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const daysInMonth = lastDay.getDate();
    const nextDates: (number | null)[] = [];

    for (let i = 0; i < firstDay.getDay(); i++) {
      nextDates.push(null);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      nextDates.push(day);
    }

    return {
      startDay: firstDay.getDay(),
      dates: nextDates,
    };
  }, [year, month]);

  const expensesByDate = useMemo(() => {
    const grouped = new Map<string, Expense[]>();

    expenses.forEach((expense) => {
      const current = grouped.get(expense.date) || [];
      grouped.set(expense.date, [...current, expense]);
    });

    return grouped;
  }, [expenses]);

  const resolvedMonthlyTotal = useMemo(
    () => monthlyTotal ?? expenses.reduce((sum, expense) => sum + expense.amount, 0),
    [expenses, monthlyTotal]
  );

  const spendingDaysCount = expensesByDate.size;

  const formatDate = (day: number) =>
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const handleYearMonthSelect = (selectedMonth: number) => {
    if (onYearMonthChange) {
      onYearMonthChange(pickerYear, selectedMonth);
    } else {
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
      {onPrevMonth && onNextMonth && (
        <div className="px-4 pt-4 pb-3">
          <div className="flex items-center justify-center">
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200/70 bg-white/75 px-2 py-1.5 backdrop-blur-sm">
              <button
                onClick={onPrevMonth}
                className="p-1.5 hover:bg-white/70 rounded-lg transition-colors"
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
                className="min-w-[132px] rounded-xl px-3 py-1 text-center text-lg font-semibold text-slate-800 transition-colors hover:bg-white/70"
              >
                {year}년 {month}월
              </button>

              <button
                onClick={onNextMonth}
                className="p-1.5 hover:bg-white/70 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-center gap-2 text-xs text-slate-500">
            <span>{resolvedMonthlyTotal.toLocaleString()}원</span>
            <span className="h-1 w-1 rounded-full bg-slate-300" />
            <span>{spendingDaysCount}일 지출</span>
          </div>
        </div>
      )}

      {showYearMonthPicker && (
        <Portal>
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/20 p-4 backdrop-blur-sm"
            onClick={() => setShowYearMonthPicker(false)}
          >
            <div
              className="w-72 rounded-2xl bg-white p-4 shadow-xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <button
                  onClick={() => setPickerYear(pickerYear - 1)}
                  className="rounded-lg p-2 transition-colors hover:bg-slate-100"
                >
                  <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <span className="text-xl font-bold text-slate-800">{pickerYear}년</span>
                <button
                  onClick={() => setPickerYear(pickerYear + 1)}
                  className="rounded-lg p-2 transition-colors hover:bg-slate-100"
                >
                  <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>

              <div className="grid grid-cols-4 gap-2">
                {MONTHS.map((value) => (
                  <button
                    key={value}
                    onClick={() => handleYearMonthSelect(value)}
                    className={`rounded-xl py-3 text-sm font-medium transition-colors ${
                      pickerYear === year && value === month
                        ? 'bg-blue-500 text-white'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {value}월
                  </button>
                ))}
              </div>

              <button
                onClick={() => {
                  const today = new Date();
                  onYearMonthChange?.(today.getFullYear(), today.getMonth() + 1);
                  setShowYearMonthPicker(false);
                }}
                className="mt-4 w-full rounded-xl bg-slate-100 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200"
              >
                오늘로 이동
              </button>
            </div>
          </div>
        </Portal>
      )}

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

      <div className="grid grid-cols-7 overflow-hidden rounded-b-2xl p-1">
        {dates.map((day, index) => {
          if (day === null) {
            return (
              <div
                key={`empty-${index}`}
                className="m-[1px] h-14 rounded-xl bg-slate-50/40 md:h-28"
              />
            );
          }

          const dateStr = formatDate(day);
          const dayExpenses = expensesByDate.get(dateStr) || [];
          const dayTotal = dayExpenses.reduce((sum, expense) => sum + expense.amount, 0);
          const categoryColors = Array.from(
            new Set(dayExpenses.map((expense) => getCategoryColor(expense.category)))
          );
          const isSelected = selectedDate === dateStr;
          const dayOfWeek = (startDay + day - 1) % 7;
          const isToday = new Date().toISOString().slice(0, 10) === dateStr;

          return (
            <div
              key={day}
              onClick={() => onDateClick(dateStr)}
              className={`m-[1px] h-14 cursor-pointer rounded-xl border p-1 transition-all md:h-28 md:p-2 ${
                isSelected
                  ? 'border-blue-300 bg-white shadow-sm ring-2 ring-blue-200/60'
                  : 'border-transparent hover:border-slate-200/70 hover:bg-white/80'
              }`}
            >
              <div className="flex h-full flex-col">
                <div className="flex items-start justify-between gap-1">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold md:h-7 md:w-7 md:text-sm ${
                      isToday
                        ? 'bg-blue-500 text-white'
                        : DAY_COLORS[dayOfWeek]
                    }`}
                  >
                    {day}
                  </span>

                  {dayTotal > 0 && (
                    <span className="text-[10px] font-semibold text-slate-500 md:text-xs">
                      {dayTotal >= 100000 ? formatCompactAmount(dayTotal) : dayTotal.toLocaleString()}
                    </span>
                  )}
                </div>

                {dayExpenses.length > 0 && (
                  <>
                    <div className="mt-auto hidden items-center gap-1.5 md:flex">
                      <div className="flex items-center gap-1">
                        {categoryColors.slice(0, 3).map((color, colorIndex) => (
                          <span
                            key={`${dateStr}-${color}-${colorIndex}`}
                            className="h-2.5 w-2.5 rounded-full ring-2 ring-white"
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                        {dayExpenses.length}건
                      </span>
                    </div>

                    <div className="mt-auto flex items-center justify-center gap-1 md:hidden">
                      <div className="flex items-center gap-0.5">
                        {categoryColors.slice(0, 2).map((color, colorIndex) => (
                          <span
                            key={`${dateStr}-mobile-${color}-${colorIndex}`}
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                      <span className="text-[9px] font-medium text-slate-400">
                        {dayExpenses.length}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
