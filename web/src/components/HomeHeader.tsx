'use client';

import Link from 'next/link';
import { useTheme } from '@/contexts/ThemeContext';
import { useHousehold } from '@/contexts/HouseholdContext';

interface HomeHeaderProps {
  onSearchClick: () => void;
  currentMonth: number;
  totalSpent: number;
  expenseCount: number;
}

export default function HomeHeader({
  onSearchClick,
  currentMonth,
  totalSpent,
  expenseCount,
}: HomeHeaderProps) {
  const { themeConfig } = useTheme();
  const { household } = useHousehold();

  return (
    <header className="mb-6 flex flex-col gap-4 md:gap-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <Link
          href="/assets"
          className="group flex min-w-0 items-center gap-3 hover:opacity-90 transition-opacity"
        >
          <div className="min-w-0 space-y-1.5">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/85 px-3 py-1 text-[11px] font-semibold tracking-[0.08em] text-slate-500 backdrop-blur-sm">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: themeConfig.accent }}
              />
              {currentMonth}월 리포트
            </div>
            <h1
              className="text-xl md:text-3xl font-bold leading-tight"
              style={{
                background: themeConfig.titleGradient,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              {household?.name || '우리집'}
              <br />
              가계부
            </h1>
            <p className="text-sm md:text-[15px] text-slate-500">
              이번 달 {expenseCount.toLocaleString()}건 · 총 {totalSpent.toLocaleString()}원
            </p>
          </div>

          <div className="relative flex-shrink-0">
            <div className="absolute inset-1 rounded-full bg-white/70 blur-xl" />
            <img
              src="/bear-removebg-preview.png"
              alt="가계부 마스코트"
              className="relative w-14 h-14 md:w-16 md:h-16 object-contain transition-transform group-hover:-translate-y-0.5"
            />
          </div>
        </Link>

        <div className="flex items-center gap-1.5 self-end rounded-2xl border border-slate-200/70 bg-white/90 p-1.5 shadow-sm backdrop-blur-sm md:self-auto">
          <button
            onClick={onSearchClick}
            className="rounded-xl px-3 py-2 text-slate-600 transition-all hover:bg-slate-50 hover:text-slate-900 md:px-4"
          >
            <span className="flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span className="hidden md:inline">검색</span>
            </span>
          </button>

          <Link
            href="/settings"
            className="rounded-xl px-3 py-2 text-slate-600 transition-all hover:bg-slate-50 hover:text-slate-900 md:px-4"
          >
            <span className="flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="hidden md:inline">설정</span>
            </span>
          </Link>

          <Link
            href="/stats"
            className="rounded-xl px-3 py-2 text-slate-600 transition-all hover:bg-slate-50 hover:text-slate-900 md:px-4"
          >
            <span className="flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <span className="hidden md:inline">통계</span>
            </span>
          </Link>
        </div>
      </div>
    </header>
  );
}
