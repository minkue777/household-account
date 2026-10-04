import { Platform } from '@/lib/utils/platform';
import type {
  ClientStartupDiagnostics, ClientStartupTiming,
} from '@/platform/functions-api/clientStartupDiagnosticsContract';

type Visibility = ClientStartupDiagnostics['initialVisibility'];
type Cache = NonNullable<ClientStartupDiagnostics['cache']>;
const MAX_DURATION_MS = 120_000;

let tracking: {
  initialVisibility: Visibility;
  visibilityTrackingStartedAtMs: number;
  visibility: Visibility;
  hiddenSince?: number;
  hiddenMs: number;
  hiddenCount: number;
  timingsMs: ClientStartupDiagnostics['timingsMs'];
  cache: { -readonly [K in keyof Cache]: Cache[K] };
  yearSummaryRequired?: boolean;
} | undefined;
let finished = false;
let captured: ClientStartupDiagnostics | undefined;

export function isClientStartupInProgress(): boolean {
  return tracking !== undefined && !finished;
}

function validTime(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    && value >= 0 && value <= MAX_DURATION_MS
    ? Math.round(value * 1_000) / 1_000 : undefined;
}

function now(): number | undefined {
  try { return validTime(window.performance?.now()); } catch { return undefined; }
}

function visibility(): Visibility {
  try {
    return document.visibilityState === 'visible' || document.visibilityState === 'hidden'
      ? document.visibilityState : 'unknown';
  } catch { return 'unknown'; }
}

function onVisibilityChange(): void {
  if (!tracking || finished) return;
  const time = now();
  const next = visibility();
  if (time === undefined || next === tracking.visibility) return;
  if (tracking.hiddenSince !== undefined) {
    tracking.hiddenMs += Math.max(0, time - tracking.hiddenSince);
    tracking.hiddenSince = undefined;
  }
  if (next === 'hidden') {
    tracking.hiddenSince = time;
    tracking.hiddenCount = Math.min(1_000, tracking.hiddenCount + 1);
  }
  tracking.visibility = next;
}

/** bootstrap 이전의 background 시간을 추정하거나 0으로 채우지 않습니다. */
export function startClientStartupDiagnostics(startedAtMs?: number): void {
  try {
    if (tracking || finished || !Platform.isIOSPWA()) return;
    const time = startedAtMs === undefined ? now() : validTime(startedAtMs);
    if (time === undefined) return;
    const initialVisibility = visibility();
    tracking = {
      initialVisibility, visibility: initialVisibility,
      visibilityTrackingStartedAtMs: time,
      hiddenSince: initialVisibility === 'hidden' ? time : undefined,
      hiddenMs: 0, hiddenCount: initialVisibility === 'hidden' ? 1 : 0,
      timingsMs: { bootstrapStarted: time }, cache: {},
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
  } catch {
    // 시작 계측도 인증/화면 초기화와 독립적인 best-effort 작업입니다.
    tracking = undefined;
  }
}

export function recordClientStartupTiming(timing: ClientStartupTiming, observedAtMs?: number): void {
  try {
    if (!tracking || finished || tracking.timingsMs[timing] !== undefined) return;
    const time = observedAtMs === undefined ? now() : validTime(observedAtMs);
    if (time !== undefined) tracking.timingsMs[timing] = time;
  } catch {
    // 계측 실패는 원래 인증 observer와 서버 snapshot callback을 막지 않습니다.
  }
}

export function recordClientStartupCache<K extends keyof Cache>(key: K, value: Cache[K]): void {
  if (!tracking || finished || tracking.cache[key] !== undefined) return;
  tracking.cache[key] = value;
}

export function recordClientStartupYearSummaryRequired(required: boolean): void {
  if (tracking && !finished) tracking.yearSummaryRequired = required;
}

/** 완료된 토큰 요청의 숫자 시각만 읽습니다. 갱신·네트워크 관측기를 추가하지 않습니다. */
function readCompletedTokenRequest(end: number): Partial<Record<ClientStartupTiming, number>> {
  try {
    const resources = window.performance.getEntriesByType?.('resource') ?? [];
    let first: { started: number; ended: number } | undefined;
    for (const resource of resources) {
      const entry = resource as PerformanceResourceTiming;
      const started = validTime(entry.startTime);
      const ended = validTime(entry.responseEnd);
      if (started === undefined || ended === undefined || ended <= 0 || ended < started || ended > end) continue;
      // origin/path만 비교하며 query·URL 원문은 보관하지 않습니다.
      let url: URL;
      try { url = new URL(entry.name); } catch { continue; }
      if (url.origin !== 'https://securetoken.googleapis.com' || url.pathname !== '/v1/token') continue;
      if (!first || started < first.started) first = { started, ended };
    }
    return first ? { authTokenRequestStarted: first.started, authTokenResponseEnd: first.ended } : {};
  } catch {
    // Resource Timing 미지원·제한·버퍼 누락은 미관측이며 0이나 cache hit로 추정하지 않습니다.
    return {};
  }
}

/** 첫 전체 paint 시점에 동결합니다. 이후 통계 전송/다른 화면은 시각을 바꾸지 않습니다. */
export function completeClientStartupDiagnostics(completedAtMs?: number): ClientStartupDiagnostics | undefined {
  if (finished) return captured;
  finished = true;
  document.removeEventListener('visibilitychange', onVisibilityChange);
  if (!tracking) return undefined;
  const state = tracking;
  const end = completedAtMs === undefined ? now() : validTime(completedAtMs);
  if (end === undefined || state.visibilityTrackingStartedAtMs > end) return undefined;
  const timingsMs = { ...state.timingsMs, ...readCompletedTokenRequest(end) };
  let navigationType: ClientStartupDiagnostics['navigationType'];
  try {
    const navigation = window.performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (navigation) {
      if (['navigate', 'reload', 'back_forward', 'prerender'].includes(navigation.type)) {
        navigationType = navigation.type;
      }
      for (const [key, value] of [
        ['navigationResponseStart', navigation.responseStart],
        ['navigationResponseEnd', navigation.responseEnd],
        ['domInteractive', navigation.domInteractive],
      ] as const) {
        const time = validTime(value);
        // Navigation Timing의 0은 해당 milestone이 아직 없거나 제공되지 않음을 뜻합니다.
        if (time !== undefined && time > 0 && time <= end) timingsMs[key] = time;
      }
    }
  } catch { /* Navigation Timing 미지원이면 관측 가능한 callback 값만 보냅니다. */ }
  const build = process.env.NEXT_PUBLIC_PWA_WORKER_VERSION;
  const hiddenMs = Math.min(MAX_DURATION_MS, state.hiddenMs
    + (state.hiddenSince === undefined ? 0 : Math.max(0, end - state.hiddenSince)));
  captured = {
    version: 1,
    ...(build && /^[A-Za-z0-9._-]{1,128}$/.test(build) ? { webBuild: build } : {}),
    ...(navigationType ? { navigationType } : {}),
    initialVisibility: state.initialVisibility,
    visibilityTrackingStartedAtMs: state.visibilityTrackingStartedAtMs,
    hiddenMs: Math.round(hiddenMs * 1_000) / 1_000,
    hiddenCount: state.hiddenCount,
    ...('serviceWorker' in navigator
      ? { serviceWorkerControlled: navigator.serviceWorker.controller !== null } : {}),
    ...(state.yearSummaryRequired === undefined ? {} : { yearSummaryRequired: state.yearSummaryRequired }),
    ...(Object.keys(state.cache).length ? { cache: { ...state.cache } } : {}),
    timingsMs,
  };
  return captured;
}
