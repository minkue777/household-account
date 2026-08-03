'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { CategoryProvider } from '@/contexts/CategoryContext';
import { HouseholdProvider } from '@/contexts/HouseholdContext';
import { LedgerReadModelProvider } from '@/contexts/LedgerReadModelContext';
import HouseholdGuard from './HouseholdGuard';
import { useHousehold } from '@/contexts/HouseholdContext';
import { getClientSessionScope } from '@/composition/clientSessionScope';
import {
  isAndroidHostAvailable,
  refreshAndroidHostSession,
} from '@/platform/android-host/androidHostBridge';
import { ANDROID_NATIVE_RESUME_EVENT } from '@/platform/android-host/androidLifecycleEvents';
import {
  scheduleAfterWebFirstHomeCompletePaint,
  scheduleAfterWebFirstLedgerPaint,
} from '@/platform/performance/webStartupPerformance';
import { preloadLedgerMutationRuntime } from '@/composition/ledgerMutationRuntimePreload';
import { AppDialogProvider } from '@/contexts/AppDialogContext';
import { REMOTE_SESSION_RECOVERY_REQUESTED_EVENT } from '@/platform/functions-api/firebaseCallableRecovery';
import { clearRetiredHomeReadSnapshots } from '@/platform/read-model/retiredHomeReadSnapshotCleanup';

const PWA_SERVICE_WORKER_PATH = '/sw.js';
const PWA_UPDATE_DELAY_AFTER_LEDGER_MS = 10_000;
const PWA_UPDATE_IDLE_TIMEOUT_MS = 10_000;
const ANDROID_WORKER_CLEANUP_DELAY_AFTER_LEDGER_MS = 2_000;
const ANDROID_WORKER_CLEANUP_FALLBACK_MS = 15_000;
const MUTATION_PRELOAD_DELAY_AFTER_LEDGER_MS = 3_000;
const MUTATION_PRELOAD_IDLE_TIMEOUT_MS = 15_000;
const VISIT_TELEMETRY_IDLE_TIMEOUT_MS = 5_000;
const ROUTE_PREFETCH_IDLE_TIMEOUT_MS = 10_000;
const POST_LEDGER_PREFETCH_ROUTES = [
  '/income',
  '/assets',
  '/settings',
  '/stats',
] as const;

function RetiredHomeReadSnapshotCleanup() {
  useEffect(() => {
    clearRetiredHomeReadSnapshots();
  }, []);
  return null;
}

function isManagedPwaWorker(worker: ServiceWorker | null | undefined): boolean {
  if (!worker) return false;
  try {
    return new URL(worker.scriptURL, window.location.origin).pathname === PWA_SERVICE_WORKER_PATH;
  } catch {
    return false;
  }
}

function isManagedPwaRegistration(
  registration: ServiceWorkerRegistration | undefined
): registration is ServiceWorkerRegistration {
  return registration !== undefined && [
    registration.active,
    registration.waiting,
    registration.installing,
  ].some(isManagedPwaWorker);
}

function WebRuntimeUpdateRecovery() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;

    let cancelled = false;
    let reloading = false;
    let lastCheckedAt = 0;
    let reloadForManagedController = false;
    let listenersAttached = false;

    const reloadForNewController = () => {
      if (!reloadForManagedController || reloading) return;
      reloading = true;
      window.location.reload();
    };

    const checkForUpdate = () => {
      if (Date.now() - lastCheckedAt < 15 * 60 * 1_000) return;
      lastCheckedAt = Date.now();
      void navigator.serviceWorker
        .getRegistration('/')
        .then(async (registration) => {
          if (cancelled) return;
          if (!registration) {
            await navigator.serviceWorker.register(PWA_SERVICE_WORKER_PATH, {
              scope: '/',
            });
            return;
          }
          if (!isManagedPwaRegistration(registration)) return;
          reloadForManagedController = isManagedPwaWorker(
            navigator.serviceWorker.controller
          );
          await registration.update();
        })
        .catch(() => {});
    };

    if (isAndroidHostAvailable()) {
      // Remove a worker left by an older auto-registration build. Its current
      // controller can finish this page, but it will not control future loads.
      const cancelCleanup = scheduleAfterWebFirstLedgerPaint(
        () => {
          void navigator.serviceWorker
            .getRegistration('/')
            .then((registration) => {
              if (!cancelled && isManagedPwaRegistration(registration)) {
                return registration.unregister();
              }
              return undefined;
            })
            .catch(() => {});
        },
        {
          delayAfterPaintMs: ANDROID_WORKER_CLEANUP_DELAY_AFTER_LEDGER_MS,
          fallbackMs: ANDROID_WORKER_CLEANUP_FALLBACK_MS,
          idleTimeoutMs: PWA_UPDATE_IDLE_TIMEOUT_MS,
        }
      );
      return () => {
        cancelled = true;
        cancelCleanup();
      };
    }

    const cancelScheduledUpdate = scheduleAfterWebFirstLedgerPaint(
      () => {
        if (cancelled) return;
        listenersAttached = true;
        navigator.serviceWorker.addEventListener(
          'controllerchange',
          reloadForNewController
        );
        window.addEventListener('focus', checkForUpdate);
        window.addEventListener('pageshow', checkForUpdate);
        checkForUpdate();
      },
      {
        delayAfterPaintMs: PWA_UPDATE_DELAY_AFTER_LEDGER_MS,
        idleTimeoutMs: PWA_UPDATE_IDLE_TIMEOUT_MS,
      }
    );

    return () => {
      cancelled = true;
      cancelScheduledUpdate();
      if (listenersAttached) {
        navigator.serviceWorker.removeEventListener(
          'controllerchange',
          reloadForNewController
        );
        window.removeEventListener('focus', checkForUpdate);
        window.removeEventListener('pageshow', checkForUpdate);
      }
    };
  }, []);
  return null;
}

const ANDROID_WEB_AUTH_REFRESH_INTERVAL_MS = 15 * 60 * 1_000;

export function AuthenticatedPlatformEffects() {
  const router = useRouter();
  const {
    sessionState,
    isSessionVerified,
    adminHouseholdView,
    householdKey,
    currentMember,
    recoverRemoteSession,
  } = useHousehold();

  useEffect(() => {
    if (
      sessionState !== 'ready'
      || !isSessionVerified
      || adminHouseholdView !== null
      || !isAndroidHostAvailable()
    ) return;
    let cancelled = false;
    let inFlight = false;
    const refresh = () => {
      if (cancelled || inFlight) return;
      const scope = getClientSessionScope();
      if (
        !scope
        || scope.householdId !== householdKey
        || scope.memberId !== currentMember?.id
      ) return;

      inFlight = true;
      void refreshAndroidHostSession({
        householdId: scope.householdId,
        memberId: scope.memberId,
      })
        .catch(() => {
          // FID endpoint 등록 실패는 가계부 사용을 막지 않습니다. 다음 online/resume에서 재시도합니다.
        })
        .finally(() => {
          inFlight = false;
        });
    };

    // 첫 원장 paint를 기다리지 않고 화면 표시를 막지 않는 비동기 작업으로 시작합니다.
    refresh();
    window.addEventListener('online', refresh);
    window.addEventListener(ANDROID_NATIVE_RESUME_EVENT, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('online', refresh);
      window.removeEventListener(ANDROID_NATIVE_RESUME_EVENT, refresh);
    };
  }, [
    adminHouseholdView,
    currentMember?.id,
    householdKey,
    isSessionVerified,
    sessionState,
  ]);

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

    return scheduleAfterWebFirstLedgerPaint(
      () => {
        for (const route of POST_LEDGER_PREFETCH_ROUTES) {
          router.prefetch(route);
        }
      },
      {
        idleTimeoutMs: ROUTE_PREFETCH_IDLE_TIMEOUT_MS,
      }
    );
  }, [adminHouseholdView, router, sessionState]);

  useEffect(() => {
    if (sessionState !== 'ready' || adminHouseholdView !== null) return;

    return scheduleAfterWebFirstLedgerPaint(
      () => {
        void preloadLedgerMutationRuntime().catch(() => {});
      },
      {
        delayAfterPaintMs: MUTATION_PRELOAD_DELAY_AFTER_LEDGER_MS,
        idleTimeoutMs: MUTATION_PRELOAD_IDLE_TIMEOUT_MS,
      }
    );
  }, [adminHouseholdView, sessionState]);

  useEffect(() => {
    if (sessionState !== 'ready' || !isSessionVerified || adminHouseholdView !== null) return;
    return scheduleAfterWebFirstHomeCompletePaint(
      () => {
        void import('@/platform/usage/memberAccessTelemetry')
          .then(({ recordCurrentAppVisit }) => recordCurrentAppVisit())
          .catch(() => {});
      },
      {
        idleTimeoutMs: VISIT_TELEMETRY_IDLE_TIMEOUT_MS,
      }
    );
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
        <RetiredHomeReadSnapshotCleanup />
        <WebRuntimeUpdateRecovery />
        <AuthenticatedPlatformEffects />
        <AdminHouseholdViewBanner />
        <ThemeProvider>
          <CategoryProvider>
            <LedgerReadModelProvider>
              <HouseholdGuard>
                {children}
              </HouseholdGuard>
            </LedgerReadModelProvider>
          </CategoryProvider>
        </ThemeProvider>
      </HouseholdProvider>
    </AppDialogProvider>
  );
}
