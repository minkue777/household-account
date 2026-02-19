'use client';

import { useEffect } from 'react';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { CategoryProvider } from '@/contexts/CategoryContext';
import { HouseholdProvider } from '@/contexts/HouseholdContext';
import HouseholdGuard from './HouseholdGuard';
import { refreshFcmToken } from '@/lib/pushNotificationService';

export default function AppProviders({ children }: { children: React.ReactNode }) {
  // 이미 알림 권한이 있으면 FCM 토큰 갱신 (만료 방지)
  useEffect(() => {
    refreshFcmToken().catch(() => {});
  }, []);

  return (
    <HouseholdProvider>
      <HouseholdGuard>
        <ThemeProvider>
          <CategoryProvider>
            {children}
          </CategoryProvider>
        </ThemeProvider>
      </HouseholdGuard>
    </HouseholdProvider>
  );
}
