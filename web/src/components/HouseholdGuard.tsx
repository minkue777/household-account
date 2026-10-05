'use client';

import { useHousehold } from '@/contexts/HouseholdContext';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import AppLoadingScreen from './AppLoadingScreen';

const HouseholdLogin = dynamic(() => import('./HouseholdLogin'));

export default function HouseholdGuard({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useHousehold();
  const pathname = usePathname();

  // 관리자 페이지와 게스트 페이지는 로그인 없이 접근 가능
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return <>{children}</>;
  }

  // 로딩 중
  if (isLoading) {
    return <AppLoadingScreen />;
  }

  // 인증되지 않음
  if (!isAuthenticated) {
    return <HouseholdLogin />;
  }

  return <>{children}</>;
}
