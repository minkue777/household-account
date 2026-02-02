'use client';

import { useEffect } from 'react';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { CategoryProvider } from '@/contexts/CategoryContext';
import { HouseholdProvider } from '@/contexts/HouseholdContext';
import HouseholdGuard from './HouseholdGuard';
import { isIOS, requestNotificationPermission } from '@/lib/pushNotificationService';

export default function AppProviders({ children }: { children: React.ReactNode }) {
  // 안드로이드에서 자동으로 FCM 토큰 등록
  useEffect(() => {
    const registerAndroidFcm = async () => {
      // iOS가 아니면 (안드로이드) 자동 등록
      if (!isIOS()) {
        try {
          await requestNotificationPermission();
        } catch (e) {
          // 무시 - 권한 거부되어도 상관없음
        }
      }
    };
    registerAndroidFcm();
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
