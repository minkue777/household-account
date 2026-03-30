'use client';

import Link from 'next/link';
import { TransactionType } from '@/types/expense';
import { useTheme } from '@/contexts/ThemeContext';
import { useHousehold } from '@/contexts/HouseholdContext';

interface HomeHeaderProps {
  onSearchClick: () => void;
  transactionType: TransactionType;
}

export default function HomeHeader({ onSearchClick, transactionType }: HomeHeaderProps) {
  const { themeConfig } = useTheme();
  const { household } = useHousehold();
  const isIncome = transactionType === 'income';
  const titleHref = isIncome ? '/' : '/income';
  const subtitle = isIncome ? '가계부 (수입)' : '가계부';

  return (
    <header className="mb-6 flex items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <Link href={titleHref} className="min-w-0 transition-opacity hover:opacity-80">
          <h1
            className="text-lg font-bold leading-tight md:text-2xl"
            style={{
              background: themeConfig.titleGradient,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            {household?.name || '우리집'}
            <br />
            {subtitle}
          </h1>
        </Link>

        <Link href="/assets" className="cursor-pointer transition-opacity hover:opacity-80">
          <img
            src="/lupy.png"
            alt="자산으로 이동"
            className="h-[4.5rem] w-[4.5rem] object-contain md:h-20 md:w-20"
          />
        </Link>
      </div>

      <div className="flex flex-shrink-0 items-center gap-1.5 md:gap-2">
        <button
          onClick={onSearchClick}
          className="rounded-xl border border-slate-200/70 bg-white/95 p-2 text-slate-600 shadow-sm transition-all hover:bg-white hover:shadow md:px-4 md:py-2"
        >
          <span className="flex items-center gap-2">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <span className="hidden md:inline">검색</span>
          </span>
        </button>
        <Link
          href="/settings"
          className="rounded-xl border border-slate-200/70 bg-white/95 p-2 text-slate-600 shadow-sm transition-all hover:bg-white hover:shadow md:px-4 md:py-2"
        >
          <span className="flex items-center gap-2">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            <span className="hidden md:inline">설정</span>
          </span>
        </Link>
        <Link
          href="/stats"
          className="rounded-xl border border-slate-200/70 bg-white/95 p-2 text-slate-600 shadow-sm transition-all hover:bg-white hover:shadow md:px-4 md:py-2"
        >
          <span className="flex items-center gap-2">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
            <span className="hidden md:inline">통계</span>
          </span>
        </Link>
      </div>
    </header>
  );
}
