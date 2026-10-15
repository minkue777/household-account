'use client';

import { useHousehold } from '@/contexts/HouseholdContext';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import AppLoadingScreen from './AppLoadingScreen';
import { useStartupDisplayReady } from '@/contexts/StartupDisplayContext';

const HouseholdLogin = dynamic(() => import('./HouseholdLogin'));

export default function HouseholdGuard({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated, sessionError } = useHousehold();
  const startupDisplayReady = useStartupDisplayReady();
  const pathname = usePathname();

  // 관리자 페이지와 게스트 페이지는 로그인 없이 접근 가능
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return <>{children}</>;
  }

  // 홈은 조회를 병렬로 시작하고 LedgerPage가 최소 표시시간을 적용합니다.
  const isLedgerPage = pathname === '/' || pathname === '/income';
  if (isLoading || (!startupDisplayReady && !sessionError && (!isAuthenticated || !isLedgerPage))) {
    return <AppLoadingScreen />;
  }

  // 인증되지 않음
  if (!isAuthenticated) {
    return <HouseholdLogin />;
  }

  return <>{children}</>;
}
