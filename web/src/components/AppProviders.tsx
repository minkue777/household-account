'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { CategoryProvider } from '@/contexts/CategoryContext';
import { HouseholdProvider } from '@/contexts/HouseholdContext';
import HouseholdGuard from './HouseholdGuard';
import { useHousehold } from '@/contexts/HouseholdContext';
import { getClientSessionScope } from '@/composition/clientSessionScope';
import { refreshAndroidHostSession } from '@/platform/android-host/androidHostBridge';
import { onWebFirstLedgerPaint } from '@/platform/performance/webStartupPerformance';
import { preloadLedgerMutationRuntime } from '@/composition/ledgerMutationRuntimePreload';
import { warmAssetNavigationIntent } from '@/composition/assetNavigationPrewarm';
import { AppDialogProvider } from '@/contexts/AppDialogContext';

function DeferredFirebaseSecurityInitialization() {
  // App Check SDK는 첫 화면 렌더링과 경쟁하지 않도록 브라우저가 한가해진 뒤 준비합니다.
  // 권한 검증은 Firebase Auth, App Check 강제 설정, Firestore rules가 계속 담당합니다.
  useEffect(() => {
    let cancelled = false;
    let idleCallbackId: number | undefined;
    const initialize = () => {
      if (cancelled) return;
      void import('@/platform/security/firebaseAppCheck')
        .then(({ initializeFirebaseAppCheck }) => initializeFirebaseAppCheck())
        .catch(() => {});
    };
    const delayId = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === 'function') {
        idleCallbackId = window.requestIdleCallback(initialize, { timeout: 2_000 });
      } else {
        initialize();
      }
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(delayId);
      if (idleCallbackId !== undefined && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleCallbackId);
      }
    };
  }, []);
  return null;
}

const NATIVE_SESSION_REFRESH_KEY = 'household-account.native-session-refresh.v2';
const NATIVE_SESSION_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1_000;

function AuthenticatedPlatformEffects() {
  const { sessionState, isSessionVerified, adminHouseholdView } = useHousehold();
  const router = useRouter();

  useEffect(() => {
    if (sessionState !== 'ready' || !isSessionVerified || adminHouseholdView !== null) return;
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
  }, [adminHouseholdView, isSessionVerified, sessionState]);

  useEffect(() => {
    if (sessionState !== 'ready' || adminHouseholdView !== null) return;

    return onWebFirstLedgerPaint(() => {
      router.prefetch('/income');
      router.prefetch('/assets');
      router.prefetch('/settings');
      router.prefetch('/stats');
      void Promise.all([
        preloadLedgerMutationRuntime(),
        import('@/features/category-budget/application/categoryCommands'),
      ]).catch(() => {});
    });
  }, [adminHouseholdView, router, sessionState]);

  useEffect(() => {
    if (sessionState !== 'ready' || !isSessionVerified || adminHouseholdView !== null) return;
    return onWebFirstLedgerPaint(() => {
      void warmAssetNavigationIntent().catch(() => {});
    });
  }, [adminHouseholdView, isSessionVerified, sessionState]);

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
    <AppDialogProvider>
      <HouseholdProvider>
        <DeferredFirebaseSecurityInitialization />
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
    </AppDialogProvider>
  );
}
