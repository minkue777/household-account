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
  const { sessionState, adminHouseholdView } = useHousehold();

  useEffect(() => {
    if (sessionState !== 'ready' || adminHouseholdView !== null) return;
    const scope = getClientSessionScope();
    if (scope) {
      refreshAndroidHostSession({
        householdId: scope.householdId,
        memberId: scope.memberId,
      }).catch(() => {});
    }
    refreshFcmToken().catch(() => {});
  }, [adminHouseholdView, sessionState]);

  useEffect(() => {
    if (sessionState !== 'ready' || adminHouseholdView !== null) return;

    let idleCallbackId: number | undefined;
    let cancelled = false;
    const delayId = window.setTimeout(() => {
      const warmCatalog = () => {
        if (cancelled) return;
        void import('@/composition/stockInstrumentCatalogRuntime')
          .then(({ warmStockInstrumentCatalog }) => warmStockInstrumentCatalog())
          .catch(() => {});
      };
      if (typeof window.requestIdleCallback === 'function') {
        idleCallbackId = window.requestIdleCallback(warmCatalog, { timeout: 2_000 });
      } else {
        warmCatalog();
      }
    }, 1_000);

    return () => {
      cancelled = true;
      window.clearTimeout(delayId);
      if (idleCallbackId !== undefined && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleCallbackId);
      }
    };
  }, [adminHouseholdView, sessionState]);

  return null;
}

function AdminHouseholdViewBanner() {
  const { adminHouseholdView } = useHousehold();
  if (adminHouseholdView === null) return null;
  return (
    <div className="sticky top-0 z-[70] border-b border-amber-300 bg-amber-50 px-4 py-2 text-amber-950 shadow-sm">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 text-sm">
        <span className="min-w-0 truncate">
          관리자 조회 전용 · <strong>{adminHouseholdView.householdName}</strong>
        </span>
        <a
          href="/admin"
          className="shrink-0 rounded-lg border border-amber-400 bg-white px-3 py-1 font-medium"
        >
          관리자 화면
        </a>
      </div>
    </div>
  );
}

export default function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <FirebaseSecurityBoundary>
      <HouseholdProvider>
        <AuthenticatedPlatformEffects />
        <AdminHouseholdViewBanner />
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
