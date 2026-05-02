'use client';

import Link from 'next/link';
import { BarChart3, Search, Settings } from 'lucide-react';
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
  const subtitle = isIncome ? '수입' : '지출';

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
            src="/bear-removebg-preview.png"
            alt="자산으로 이동"
            className="h-14 w-14 object-contain md:h-16 md:w-16"
          />
        </Link>
      </div>

      <div className="flex flex-shrink-0 items-center gap-1.5 md:gap-2">
        <button
          onClick={onSearchClick}
          className="rounded-xl border border-slate-200/70 bg-white/95 p-2 text-slate-600 shadow-sm transition-all hover:bg-white hover:shadow md:px-4 md:py-2"
        >
          <span className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            <span className="hidden md:inline">검색</span>
          </span>
        </button>
        <Link
          href="/settings"
          className="rounded-xl border border-slate-200/70 bg-white/95 p-2 text-slate-600 shadow-sm transition-all hover:bg-white hover:shadow md:px-4 md:py-2"
        >
          <span className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            <span className="hidden md:inline">설정</span>
          </span>
        </Link>
        <Link
          href="/stats"
          className="rounded-xl border border-slate-200/70 bg-white/95 p-2 text-slate-600 shadow-sm transition-all hover:bg-white hover:shadow md:px-4 md:py-2"
        >
          <span className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            <span className="hidden md:inline">통계</span>
          </span>
        </Link>
      </div>
    </header>
  );
}
