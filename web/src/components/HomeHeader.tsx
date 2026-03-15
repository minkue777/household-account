'use client';

import Link from 'next/link';
import { useTheme } from '@/contexts/ThemeContext';
import { useHousehold } from '@/contexts/HouseholdContext';

interface HomeHeaderProps {
  onSearchClick: () => void;
}

export default function HomeHeader({ onSearchClick }: HomeHeaderProps) {
  const { themeConfig } = useTheme();
  const { household } = useHousehold();

  return (
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
          {household?.name || '우리집'}
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
          onClick={onSearchClick}
          className="bg-white/95 hover:bg-white text-slate-600 p-2 md:px-4 md:py-2 rounded-xl flex items-center gap-2 transition-all shadow-sm hover:shadow border border-slate-200/70"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <span className="hidden md:inline">검색</span>
        </button>
        <Link
          href="/settings"
          className="bg-white/95 hover:bg-white text-slate-600 p-2 md:px-4 md:py-2 rounded-xl flex items-center gap-2 transition-all shadow-sm hover:shadow border border-slate-200/70"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="hidden md:inline">설정</span>
        </Link>
        <Link
          href="/stats"
          className="bg-white/95 hover:bg-white text-slate-600 p-2 md:px-4 md:py-2 rounded-xl flex items-center gap-2 transition-all shadow-sm hover:shadow border border-slate-200/70"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <span className="hidden md:inline">통계</span>
        </Link>
      </div>
    </header>
  );
}
