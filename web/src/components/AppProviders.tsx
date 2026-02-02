'use client';

import { useEffect } from 'react';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { CategoryProvider } from '@/contexts/CategoryContext';
import { HouseholdProvider } from '@/contexts/HouseholdContext';
import HouseholdGuard from './HouseholdGuard';
import { isIOS, requestNotificationPermission } from '@/lib/pushNotificationService';

export default function AppProviders({ children }: { children: React.ReactNode }) {
  // FCM 토큰 자동 등록/갱신
  useEffect(() => {
    const registerFcm = async () => {
      try {
        // 안드로이드: 자동 등록
        // iOS: 이미 권한 있으면 토큰 갱신 (deviceOwner 추가)
        await requestNotificationPermission();
      } catch (e) {
        // 무시
      }
    };
    registerFcm();
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
