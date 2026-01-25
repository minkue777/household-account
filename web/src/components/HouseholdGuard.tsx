'use client';

import { useHousehold } from '@/contexts/HouseholdContext';
import HouseholdLogin from './HouseholdLogin';
import { usePathname } from 'next/navigation';

export default function HouseholdGuard({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useHousehold();
  const pathname = usePathname();

  // 관리자 페이지는 로그인 없이 접근 가능
  if (pathname === '/admin') {
    return <>{children}</>;
  }

  // 로딩 중
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-slate-400">로딩중...</div>
      </div>
    );
  }

  // 인증되지 않음
  if (!isAuthenticated) {
    return <HouseholdLogin />;
  }

  return <>{children}</>;
}
