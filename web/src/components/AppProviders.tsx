'use client';

import { useEffect, useState } from 'react';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { CategoryProvider } from '@/contexts/CategoryContext';
import { HouseholdProvider } from '@/contexts/HouseholdContext';
import HouseholdGuard from './HouseholdGuard';
import { refreshFcmToken } from '@/lib/pushNotificationService';
import { useHousehold } from '@/contexts/HouseholdContext';
import { getClientSessionScope } from '@/composition/clientSessionScope';
import { refreshAndroidHostSession } from '@/platform/android-host/androidHostBridge';
import { initializeFirebaseAppCheck } from '@/platform/security/firebaseAppCheck';

function FirebaseSecurityBoundary({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    initializeFirebaseAppCheck();
    setReady(true);
  }, []);

  return ready ? children : null;
}

function AuthenticatedPlatformEffects() {
  const { sessionState } = useHousehold();

  useEffect(() => {
    if (sessionState !== 'ready') return;
    const scope = getClientSessionScope();
    if (scope) {
      refreshAndroidHostSession({
        householdId: scope.householdId,
        memberId: scope.memberId,
      }).catch(() => {});
    }
    refreshFcmToken().catch(() => {});
  }, [sessionState]);

  return null;
}

export default function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <FirebaseSecurityBoundary>
      <HouseholdProvider>
        <AuthenticatedPlatformEffects />
        <HouseholdGuard>
          <ThemeProvider>
            <CategoryProvider>
              {children}
            </CategoryProvider>
          </ThemeProvider>
        </HouseholdGuard>
      </HouseholdProvider>
    </FirebaseSecurityBoundary>
  );
}
