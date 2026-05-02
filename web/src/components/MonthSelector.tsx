'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

interface MonthSelectorProps {
  year: number;
  month: number;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}

export default function MonthSelector({
  year,
  month,
  onPrevMonth,
  onNextMonth,
}: MonthSelectorProps) {
  return (
    <div className="flex items-center gap-4">
      <button
        onClick={onPrevMonth}
        className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
        aria-label="이전 달"
      >
        <ChevronLeft className="h-5 w-5 text-slate-600" />
      </button>
      <h2 className="text-xl font-bold text-slate-800 min-w-[140px] text-center">
        {year}년 {month}월
      </h2>
      <button
        onClick={onNextMonth}
        className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
        aria-label="다음 달"
      >
        <ChevronRight className="h-5 w-5 text-slate-600" />
      </button>
    </div>
  );
}
