import { captureClientStartupObservation } from './clientStartupObservation';

const STARTUP_PREFIX = 'household-account:startup';
const FIRST_LEDGER_PAINT_EVENT = `${STARTUP_PREFIX}:first-ledger-paint`;
const FIRST_HOME_COMPLETE_PAINT_EVENT =
  `${STARTUP_PREFIX}:first-home-complete-paint`;

export const WEB_STARTUP_MARKS = {
  bootstrapStarted: `${STARTUP_PREFIX}:bootstrap:started`,
  bootstrapCacheHit: `${STARTUP_PREFIX}:bootstrap-cache:hit`,
  bootstrapCacheMiss: `${STARTUP_PREFIX}:bootstrap-cache:miss`,
  authStarted: `${STARTUP_PREFIX}:auth:started`,
  authReady: `${STARTUP_PREFIX}:auth:ready`,
  authFailed: `${STARTUP_PREFIX}:auth:failed`,
  membershipCacheHit: `${STARTUP_PREFIX}:membership-cache:hit`,
  membershipPrefetched: `${STARTUP_PREFIX}:membership-prefetched`,
  membershipStarted: `${STARTUP_PREFIX}:membership:started`,
  membershipReady: `${STARTUP_PREFIX}:membership:ready`,
  membershipFailed: `${STARTUP_PREFIX}:membership:failed`,
  householdCacheHit: `${STARTUP_PREFIX}:household-cache:hit`,
  householdCacheMiss: `${STARTUP_PREFIX}:household-cache:miss`,
  householdStarted: `${STARTUP_PREFIX}:household:started`,
  householdReady: `${STARTUP_PREFIX}:household:ready`,
  householdFailed: `${STARTUP_PREFIX}:household:failed`,
  sessionReady: `${STARTUP_PREFIX}:session:ready`,
  ledgerRequested: `${STARTUP_PREFIX}:ledger:requested`,
  ledgerReady: `${STARTUP_PREFIX}:ledger:ready`,
  categoriesRequested: `${STARTUP_PREFIX}:categories:requested`,
  categoriesReady: `${STARTUP_PREFIX}:categories:ready`,
  localCurrencyRequested: `${STARTUP_PREFIX}:local-currency:requested`,
  localCurrencyReady: `${STARTUP_PREFIX}:local-currency:ready`,
  ledgerCacheHit: `${STARTUP_PREFIX}:ledger-cache:hit`,
  ledgerCacheMiss: `${STARTUP_PREFIX}:ledger-cache:miss`,
  firstLedgerPaint: `${STARTUP_PREFIX}:ledger:first-paint`,
  firstHomeCompletePaint: `${STARTUP_PREFIX}:home:first-complete-paint`,
} as const;

export const WEB_STARTUP_MEASURES = {
  bootstrapCache: `${STARTUP_PREFIX}:duration:bootstrap-cache`,
  auth: `${STARTUP_PREFIX}:duration:auth`,
  membership: `${STARTUP_PREFIX}:duration:membership`,
  household: `${STARTUP_PREFIX}:duration:household`,
  firstLedgerPaint: `${STARTUP_PREFIX}:duration:first-ledger-paint`,
  firstHomeCompletePaint:
    `${STARTUP_PREFIX}:duration:first-home-complete-paint`,
} as const;

let firstLedgerPaintReached = false;
let firstHomeCompletePaintReached = false;
const recordedMarks = new Set<string>();
const recordedMeasures = new Set<string>();

const STARTUP_TIMING_MARKS = {
  bootstrapStarted: WEB_STARTUP_MARKS.bootstrapStarted,
  authStarted: WEB_STARTUP_MARKS.authStarted,
  authReady: WEB_STARTUP_MARKS.authReady,
  membershipStarted: WEB_STARTUP_MARKS.membershipStarted,
  membershipReady: WEB_STARTUP_MARKS.membershipReady,
  sessionReady: WEB_STARTUP_MARKS.sessionReady,
  ledgerRequested: WEB_STARTUP_MARKS.ledgerRequested,
  ledgerReady: WEB_STARTUP_MARKS.ledgerReady,
  categoriesRequested: WEB_STARTUP_MARKS.categoriesRequested,
  categoriesReady: WEB_STARTUP_MARKS.categoriesReady,
  localCurrencyRequested: WEB_STARTUP_MARKS.localCurrencyRequested,
  localCurrencyReady: WEB_STARTUP_MARKS.localCurrencyReady,
  firstLedgerPaint: WEB_STARTUP_MARKS.firstLedgerPaint,
  firstHomeCompletePaint: WEB_STARTUP_MARKS.firstHomeCompletePaint,
} as const;

/** Fixed numeric checkpoints only; no URLs, identifiers, or resource names. */
export function readWebStartupTimingsMs(): Readonly<Record<string, number>> | undefined {
  try {
    const performance = browserPerformance();
    if (!performance || typeof performance.getEntriesByName !== 'function') return undefined;
    const timings: Record<string, number> = {};
    const add = (key: string, value: unknown) => {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 120_000) {
        timings[key] = Math.round(value * 1_000) / 1_000;
      }
    };
    const navigation = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined;
    // A zero responseEnd denotes an unavailable timing, rather than a free request.
    if (navigation && navigation.responseEnd > 0) add('navigationResponseEnd', navigation.responseEnd);
    for (const [key, name] of Object.entries(STARTUP_TIMING_MARKS)) {
      add(key, performance.getEntriesByName(name, 'mark')[0]?.startTime);
    }
    return Object.keys(timings).length > 0 ? timings : undefined;
  } catch {
    return undefined;
  }
}

export function markWebSessionReady(): void {
  markOnce(WEB_STARTUP_MARKS.sessionReady);
}

export function markWebHomeRead(
  source: 'ledger' | 'categories' | 'localCurrency',
  stage: 'requested' | 'ready'
): void {
  const key = `${source}${stage === 'requested' ? 'Requested' : 'Ready'}` as
    'ledgerRequested' | 'ledgerReady' | 'categoriesRequested' | 'categoriesReady' |
    'localCurrencyRequested' | 'localCurrencyReady';
  markOnce(WEB_STARTUP_MARKS[key]);
}

function browserPerformance(): Performance | undefined {
  if (typeof window === 'undefined') return undefined;
  const candidate = window.performance;
  return candidate && typeof candidate.mark === 'function' ? candidate : undefined;
}

function hasEntry(name: string, entryType?: string): boolean {
  const performance = browserPerformance();
  if (!performance || typeof performance.getEntriesByName !== 'function') return false;
  return performance.getEntriesByName(name, entryType).length > 0;
}

function markOnce(name: string): void {
  const performance = browserPerformance();
  if (!performance || recordedMarks.has(name) || hasEntry(name, 'mark')) return;
  try {
    performance.mark(name);
    recordedMarks.add(name);
  } catch {
    // Performance telemetry must never interrupt session restoration.
  }
}

function measureOnce(name: string, startMark: string, endMark: string): void {
  const performance = browserPerformance();
  if (
    !performance
    || typeof performance.measure !== 'function'
    || recordedMeasures.has(name)
    || hasEntry(name, 'measure')
    || !hasEntry(startMark, 'mark')
    || !hasEntry(endMark, 'mark')
  ) {
    return;
  }
  try {
    performance.measure(name, startMark, endMark);
    recordedMeasures.add(name);
  } catch {
    // Some embedded browsers can evict marks; measurement is best-effort only.
  }
}

export function markWebBootstrapStarted(): void {
  markOnce(WEB_STARTUP_MARKS.bootstrapStarted);
}

export function markWebBootstrapCacheResult(hit: boolean): void {
  const resultMark = hit
    ? WEB_STARTUP_MARKS.bootstrapCacheHit
    : WEB_STARTUP_MARKS.bootstrapCacheMiss;
  markOnce(resultMark);
  measureOnce(
    WEB_STARTUP_MEASURES.bootstrapCache,
    WEB_STARTUP_MARKS.bootstrapStarted,
    resultMark
  );
}

export function markWebAuthStarted(): void {
  markOnce(WEB_STARTUP_MARKS.authStarted);
}

export function markWebAuthCompleted(success: boolean): void {
  const resultMark = success ? WEB_STARTUP_MARKS.authReady : WEB_STARTUP_MARKS.authFailed;
  markOnce(resultMark);
  measureOnce(
    WEB_STARTUP_MEASURES.auth,
    WEB_STARTUP_MARKS.authStarted,
    resultMark
  );
}

export function markWebMembershipCacheUsed(): void {
  markOnce(WEB_STARTUP_MARKS.membershipCacheHit);
}

export function markWebMembershipPrefetched(): void {
  markOnce(WEB_STARTUP_MARKS.membershipPrefetched);
}

export function markWebMembershipStarted(): void {
  markOnce(WEB_STARTUP_MARKS.membershipStarted);
}

export function markWebMembershipCompleted(success: boolean): void {
  const resultMark = success
    ? WEB_STARTUP_MARKS.membershipReady
    : WEB_STARTUP_MARKS.membershipFailed;
  markOnce(resultMark);
  measureOnce(
    WEB_STARTUP_MEASURES.membership,
    WEB_STARTUP_MARKS.membershipStarted,
    resultMark
  );
}

export function markWebHouseholdCacheResult(hit: boolean): void {
  markOnce(
    hit ? WEB_STARTUP_MARKS.householdCacheHit : WEB_STARTUP_MARKS.householdCacheMiss
  );
}

export function markWebHouseholdStarted(): void {
  markOnce(WEB_STARTUP_MARKS.householdStarted);
}

export function markWebHouseholdCompleted(success: boolean): void {
  const resultMark = success
    ? WEB_STARTUP_MARKS.householdReady
    : WEB_STARTUP_MARKS.householdFailed;
  markOnce(resultMark);
  measureOnce(
    WEB_STARTUP_MEASURES.household,
    WEB_STARTUP_MARKS.householdStarted,
    resultMark
  );
}

export function markWebLedgerCacheResult(hit: boolean): void {
  markOnce(hit ? WEB_STARTUP_MARKS.ledgerCacheHit : WEB_STARTUP_MARKS.ledgerCacheMiss);
}

export function markWebFirstLedgerPaint(): void {
  if (firstLedgerPaintReached) return;
  firstLedgerPaintReached = true;
  markOnce(WEB_STARTUP_MARKS.firstLedgerPaint);
  measureOnce(
    WEB_STARTUP_MEASURES.firstLedgerPaint,
    WEB_STARTUP_MARKS.bootstrapStarted,
    WEB_STARTUP_MARKS.firstLedgerPaint
  );
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(FIRST_LEDGER_PAINT_EVENT));
  }
}

export function markWebFirstHomeCompletePaint(): void {
  if (firstHomeCompletePaintReached) return;
  firstHomeCompletePaintReached = true;
  markOnce(WEB_STARTUP_MARKS.firstHomeCompletePaint);
  measureOnce(
    WEB_STARTUP_MEASURES.firstHomeCompletePaint,
    WEB_STARTUP_MARKS.bootstrapStarted,
    WEB_STARTUP_MARKS.firstHomeCompletePaint
  );
  // 측정용 작업은 화면 표시가 끝난 뒤 시작하며 실패가 사용자 기능에 전파되지 않습니다.
  void captureClientStartupObservation(readWebStartupTimingsMs());
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(FIRST_HOME_COMPLETE_PAINT_EVENT));
  }
}

export function onWebFirstLedgerPaint(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  if (firstLedgerPaintReached || hasEntry(WEB_STARTUP_MARKS.firstLedgerPaint, 'mark')) {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) listener();
    });
    return () => {
      cancelled = true;
    };
  }

  const handleFirstPaint = () => listener();
  window.addEventListener(FIRST_LEDGER_PAINT_EVENT, handleFirstPaint, { once: true });
  return () => window.removeEventListener(FIRST_LEDGER_PAINT_EVENT, handleFirstPaint);
}

export function onWebFirstHomeCompletePaint(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  if (
    firstHomeCompletePaintReached
    || hasEntry(WEB_STARTUP_MARKS.firstHomeCompletePaint, 'mark')
  ) {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) listener();
    });
    return () => {
      cancelled = true;
    };
  }

  const handleFirstPaint = () => listener();
  window.addEventListener(
    FIRST_HOME_COMPLETE_PAINT_EVENT,
    handleFirstPaint,
    { once: true }
  );
  return () =>
    window.removeEventListener(
      FIRST_HOME_COMPLETE_PAINT_EVENT,
      handleFirstPaint
    );
}

interface PostLedgerPaintTaskOptions {
  readonly delayAfterPaintMs?: number;
  readonly fallbackMs?: number;
  readonly idleTimeoutMs?: number;
}

function scheduleAfterWebPaint(
  subscribe: (listener: () => void) => () => void,
  task: () => void,
  options: PostLedgerPaintTaskOptions = {}
): () => void {
  if (typeof window === 'undefined') return () => {};

  let cancelled = false;
  let started = false;
  let delayId: number | undefined;
  let fallbackId: number | undefined;
  let idleCallbackId: number | undefined;

  const runWhenIdle = () => {
    if (cancelled) return;
    if (typeof window.requestIdleCallback === 'function') {
      idleCallbackId = window.requestIdleCallback(
        () => {
          if (!cancelled) task();
        },
        { timeout: options.idleTimeoutMs ?? 5_000 }
      );
    } else {
      task();
    }
  };

  const begin = () => {
    if (cancelled || started) return;
    started = true;
    if (fallbackId !== undefined) window.clearTimeout(fallbackId);
    delayId = window.setTimeout(runWhenIdle, options.delayAfterPaintMs ?? 0);
  };

  const unsubscribe = subscribe(begin);
  if (options.fallbackMs !== undefined) {
    fallbackId = window.setTimeout(begin, options.fallbackMs);
  }

  return () => {
    cancelled = true;
    unsubscribe();
    if (delayId !== undefined) window.clearTimeout(delayId);
    if (fallbackId !== undefined) window.clearTimeout(fallbackId);
    if (
      idleCallbackId !== undefined
      && typeof window.cancelIdleCallback === 'function'
    ) {
      window.cancelIdleCallback(idleCallbackId);
    }
  };
}

/**
 * Keeps optional startup work behind the first useful ledger paint.
 * A fallback is opt-in for correctness work needed on routes that never render the ledger.
 */
export function scheduleAfterWebFirstLedgerPaint(
  task: () => void,
  options: PostLedgerPaintTaskOptions = {}
): () => void {
  return scheduleAfterWebPaint(onWebFirstLedgerPaint, task, options);
}

/** 첫 화면의 모든 최신 데이터가 실제로 그려진 뒤에만 진단 작업을 시작합니다. */
export function scheduleAfterWebFirstHomeCompletePaint(
  task: () => void,
  options: PostLedgerPaintTaskOptions = {}
): () => void {
  return scheduleAfterWebPaint(onWebFirstHomeCompletePaint, task, options);
}
