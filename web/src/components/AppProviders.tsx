'use client';

import { useEffect } from 'react';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { CategoryProvider } from '@/contexts/CategoryContext';
import { HouseholdProvider } from '@/contexts/HouseholdContext';
import HouseholdGuard from './HouseholdGuard';
import { useHousehold } from '@/contexts/HouseholdContext';
import { getClientSessionScope } from '@/composition/clientSessionScope';
import { refreshAndroidHostSession } from '@/platform/android-host/androidHostBridge';
import { initializeFirebaseAppCheck } from '@/platform/security/firebaseAppCheck';

function FirebaseSecurityBoundary({ children }: { children: React.ReactNode }) {
  // App Check 설치는 동기식이므로 첫 paint를 한 번 비우지 않고 바로 진행합니다.
  // 실제 callable의 token 발급·검증은 Firebase SDK가 계속 담당합니다.
  initializeFirebaseAppCheck();
  return children;
}

const NATIVE_SESSION_REFRESH_KEY = 'household-account.native-session-refresh.v1';
const NATIVE_SESSION_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1_000;

function AuthenticatedPlatformEffects() {
  const { sessionState, adminHouseholdView } = useHousehold();

  useEffect(() => {
    if (sessionState !== 'ready' || adminHouseholdView !== null) return;
    const scope = getClientSessionScope();
    if (!scope) return;

    const bindingKey = `${scope.principalUid}\u0000${scope.householdId}\u0000${scope.memberId}`;
    try {
      const stored = JSON.parse(
        window.localStorage.getItem(NATIVE_SESSION_REFRESH_KEY) ?? 'null'
      ) as { bindingKey?: unknown; refreshedAt?: unknown } | null;
      if (
        stored?.bindingKey === bindingKey
        && typeof stored.refreshedAt === 'number'
        && Date.now() - stored.refreshedAt < NATIVE_SESSION_REFRESH_INTERVAL_MS
      ) {
        return;
      }
    } catch {
      // 손상된 성능 힌트는 무시하고 아래에서 다시 동기화합니다.
    }

    let cancelled = false;
    let idleCallbackId: number | undefined;
    const refresh = () => {
      if (cancelled) return;
      void refreshAndroidHostSession({
        householdId: scope.householdId,
        memberId: scope.memberId,
      }).then(() => {
        window.localStorage.setItem(NATIVE_SESSION_REFRESH_KEY, JSON.stringify({
          bindingKey,
          refreshedAt: Date.now(),
        }));
      }).catch(() => {});
    };
    const delayId = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === 'function') {
        idleCallbackId = window.requestIdleCallback(refresh, { timeout: 5_000 });
      } else {
        refresh();
      }
    }, 5_000);

    return () => {
      cancelled = true;
      window.clearTimeout(delayId);
      if (idleCallbackId !== undefined && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleCallbackId);
      }
    };
  }, [adminHouseholdView, sessionState]);

  useEffect(() => {
    if (sessionState !== 'ready' || adminHouseholdView !== null) return;

    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    let idleCallbackId: number | undefined;
    const warmAssets = () => {
      if (cancelled) return;
      void import('@/lib/assetService')
        .then(({ subscribeToAssets }) => {
          if (cancelled) return;
          // 자산 화면을 열기 전에 read model과 Firestore local cache를 유지합니다.
          // 실제 화면 구독과 동일 query이므로 SDK가 원격 listen을 공유합니다.
          unsubscribe = subscribeToAssets(() => {});
        })
        .catch(() => {});
    };
    if (typeof window.requestIdleCallback === 'function') {
      idleCallbackId = window.requestIdleCallback(warmAssets, { timeout: 1_000 });
    } else {
      warmAssets();
    }

    return () => {
      cancelled = true;
      unsubscribe?.();
      if (idleCallbackId !== undefined && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleCallbackId);
      }
    };
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
