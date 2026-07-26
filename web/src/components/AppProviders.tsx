'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { CategoryProvider } from '@/contexts/CategoryContext';
import { HouseholdProvider } from '@/contexts/HouseholdContext';
import HouseholdGuard from './HouseholdGuard';
import { useHousehold } from '@/contexts/HouseholdContext';
import { getClientSessionScope } from '@/composition/clientSessionScope';
import {
  isAndroidHostAvailable,
  refreshAndroidHostSession,
} from '@/platform/android-host/androidHostBridge';
import { onWebFirstLedgerPaint } from '@/platform/performance/webStartupPerformance';
import { preloadLedgerMutationRuntime } from '@/composition/ledgerMutationRuntimePreload';
import { warmAssetNavigationIntent } from '@/composition/assetNavigationPrewarm';
import { AppDialogProvider } from '@/contexts/AppDialogContext';
import { REMOTE_SESSION_RECOVERY_REQUESTED_EVENT } from '@/platform/functions-api/firebaseCallableRecovery';

function DeferredFirebaseSecurityInitialization() {
  // App Check SDK는 동적으로 불러 첫 화면 bundle에서는 분리하되 idle까지 미루지
  // 않습니다. 첫 화면 직후 실행되는 보호 callable보다 먼저 초기화를 시작합니다.
  useEffect(() => {
    let cancelled = false;
    void import('@/platform/security/firebaseAppCheck')
      .then(({ initializeFirebaseAppCheck }) => {
        if (!cancelled) initializeFirebaseAppCheck();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}

function WebRuntimeUpdateRecovery() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    let reloading = false;
    let lastCheckedAt = 0;
    const reloadForNewController = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    const checkForUpdate = () => {
      if (Date.now() - lastCheckedAt < 15 * 60 * 1_000) return;
      lastCheckedAt = Date.now();
      void navigator.serviceWorker
        .getRegistration()
        .then((registration) => registration?.update())
        .catch(() => {});
    };

    navigator.serviceWorker.addEventListener(
      'controllerchange',
      reloadForNewController
    );
    window.addEventListener('focus', checkForUpdate);
    window.addEventListener('pageshow', checkForUpdate);
    window.addEventListener('household-account:android-resume', checkForUpdate);
    checkForUpdate();

    return () => {
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        reloadForNewController
      );
      window.removeEventListener('focus', checkForUpdate);
      window.removeEventListener('pageshow', checkForUpdate);
      window.removeEventListener(
        'household-account:android-resume',
        checkForUpdate
      );
    };
  }, []);
  return null;
}

const NATIVE_SESSION_REFRESH_KEY = 'household-account.native-session-refresh.v2';
const NATIVE_SESSION_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const ANDROID_WEB_AUTH_REFRESH_INTERVAL_MS = 15 * 60 * 1_000;
const ANDROID_NATIVE_RESUME_EVENT = 'household-account:android-resume';

function AuthenticatedPlatformEffects() {
  const {
    sessionState,
    isSessionVerified,
    adminHouseholdView,
    recoverRemoteSession,
  } = useHousehold();
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
    if (
      sessionState !== 'ready'
      || adminHouseholdView !== null
      || !isAndroidHostAvailable()
    ) return;

    let cancelled = false;
    let inFlight = false;
    let retryId: number | undefined;
    let refreshIntervalId: number | undefined;
    let lastRefreshedAt = isSessionVerified ? Date.now() : 0;

    const refreshAfterResume = (force = false) => {
      if (
        cancelled
        || inFlight
        || document.visibilityState !== 'visible'
        || (
          !force
          && Date.now() - lastRefreshedAt < ANDROID_WEB_AUTH_REFRESH_INTERVAL_MS
        )
      ) return;
      if (retryId !== undefined) {
        window.clearTimeout(retryId);
        retryId = undefined;
      }
      inFlight = true;
      void recoverRemoteSession()
        .then(() => {
          lastRefreshedAt = Date.now();
        })
        .catch(() => {
          lastRefreshedAt = 0;
          if (!cancelled && document.visibilityState === 'visible') {
            retryId = window.setTimeout(refreshAfterResume, 5_000);
          }
        })
        .finally(() => {
          inFlight = false;
        });
    };

    const handleResume = () => refreshAfterResume(!isSessionVerified);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') handleResume();
    };
    const handleRecoveryRequest = () => refreshAfterResume(true);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleResume);
    window.addEventListener('pageshow', handleResume);
    window.addEventListener('online', handleResume);
    window.addEventListener(ANDROID_NATIVE_RESUME_EVENT, handleResume);
    window.addEventListener(
      REMOTE_SESSION_RECOVERY_REQUESTED_EVENT,
      handleRecoveryRequest
    );
    // WebView가 visibility/focus 이벤트를 누락해도 장시간 열린 세션은 유한 시간 안에
    // token을 확인합니다. Firestore나 업무 데이터를 polling하는 작업은 아닙니다.
    refreshIntervalId = window.setInterval(
      handleResume,
      ANDROID_WEB_AUTH_REFRESH_INTERVAL_MS
    );
    if (!isSessionVerified) queueMicrotask(() => refreshAfterResume(true));

    return () => {
      cancelled = true;
      if (retryId !== undefined) window.clearTimeout(retryId);
      if (refreshIntervalId !== undefined) window.clearInterval(refreshIntervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleResume);
      window.removeEventListener('pageshow', handleResume);
      window.removeEventListener('online', handleResume);
      window.removeEventListener(ANDROID_NATIVE_RESUME_EVENT, handleResume);
      window.removeEventListener(
        REMOTE_SESSION_RECOVERY_REQUESTED_EVENT,
        handleRecoveryRequest
      );
    };
  }, [
    adminHouseholdView,
    isSessionVerified,
    recoverRemoteSession,
    sessionState,
  ]);

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
      void import('@/platform/usage/memberAccessTelemetry')
        .then(({ recordCurrentAppVisit }) => recordCurrentAppVisit())
        .catch(() => {});
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
        <WebRuntimeUpdateRecovery />
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
