interface FakeEntry {
  readonly name: string;
  readonly entryType: 'mark' | 'measure';
}

jest.mock('@/platform/performance/clientStartupObservation', () => ({
  captureClientStartupObservation: jest.fn(async () => undefined),
}));

function installPerformanceDouble() {
  const entries: FakeEntry[] = [];
  const mark = jest.fn((name: string) => {
    entries.push({ name, entryType: 'mark' });
  });
  const measure = jest.fn((name: string, _startMark: string, _endMark: string) => {
    entries.push({ name, entryType: 'measure' });
  });
  const getEntriesByName = jest.fn((name: string, entryType?: string) =>
    entries.filter((entry) =>
      entry.name === name && (entryType === undefined || entry.entryType === entryType)
    )
  );
  Object.defineProperty(window, 'performance', {
    configurable: true,
    writable: true,
    value: { mark, measure, getEntriesByName },
  });
  return { entries, mark, measure };
}

describe('Web startup performance contract', () => {
  const originalPerformance = window.performance;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    Object.defineProperty(window, 'performance', {
      configurable: true,
      writable: true,
      value: originalPerformance,
    });
  });

  it('고정된 PII-free mark/measure로 cache, auth, membership, household, ledger를 구분한다', () => {
    const performance = installPerformanceDouble();
    const telemetry = require('@/platform/performance/webStartupPerformance') as typeof import(
      '@/platform/performance/webStartupPerformance'
    );

    telemetry.markWebBootstrapStarted();
    telemetry.markWebBootstrapCacheResult(true);
    telemetry.markWebAuthStarted();
    telemetry.markWebAuthCompleted(true);
    telemetry.markWebMembershipStarted();
    telemetry.markWebMembershipCompleted(true);
    telemetry.markWebHouseholdCacheResult(false);
    telemetry.markWebHouseholdStarted();
    telemetry.markWebHouseholdCompleted(true);
    telemetry.markWebLedgerCacheResult(true);
    telemetry.markWebFirstLedgerPaint();
    telemetry.markWebFirstHomeCompletePaint();

    expect(performance.entries).toEqual(expect.arrayContaining([
      { name: telemetry.WEB_STARTUP_MARKS.bootstrapCacheHit, entryType: 'mark' },
      { name: telemetry.WEB_STARTUP_MARKS.authReady, entryType: 'mark' },
      { name: telemetry.WEB_STARTUP_MARKS.membershipReady, entryType: 'mark' },
      { name: telemetry.WEB_STARTUP_MARKS.householdCacheMiss, entryType: 'mark' },
      { name: telemetry.WEB_STARTUP_MARKS.firstLedgerPaint, entryType: 'mark' },
      { name: telemetry.WEB_STARTUP_MEASURES.firstLedgerPaint, entryType: 'measure' },
      {
        name: telemetry.WEB_STARTUP_MARKS.firstHomeCompletePaint,
        entryType: 'mark',
      },
      {
        name: telemetry.WEB_STARTUP_MEASURES.firstHomeCompletePaint,
        entryType: 'measure',
      },
    ]));
    expect(performance.mark.mock.calls.every((args) => args.length === 1)).toBe(true);
    expect(performance.measure.mock.calls.every((args) => args.length === 3)).toBe(true);
    expect(JSON.stringify(performance.entries)).not.toMatch(/uid|householdId|memberId/i);
  });

  it('단계 기록은 같은 Web navigation 시계의 허용된 도달 시각만 복사한다', () => {
    const telemetry = require('@/platform/performance/webStartupPerformance') as typeof import(
      '@/platform/performance/webStartupPerformance'
    );
    const times = new Map([
      [telemetry.WEB_STARTUP_MARKS.authReady, 450.12345],
      [telemetry.WEB_STARTUP_MARKS.ledgerRequested, 600],
      [telemetry.WEB_STARTUP_MARKS.ledgerReady, 2_500],
      [telemetry.WEB_STARTUP_MARKS.categoriesReady, Number.NaN],
      [telemetry.WEB_STARTUP_MARKS.localCurrencyReady, 120_001],
      ['private-user-and-household', 900],
    ]);
    Object.defineProperty(window, 'performance', {
      configurable: true,
      value: {
        mark: jest.fn(),
        getEntriesByName: (name: string) => times.has(name)
          ? [{ name, entryType: 'mark', startTime: times.get(name) }] : [],
        getEntriesByType: () => [{ responseEnd: 120, name: 'https://private.example/?user=secret' }],
      },
    });
    expect(telemetry.readWebStartupTimingsMs()).toEqual({
      navigationResponseEnd: 120,
      authReady: 450.123,
      ledgerRequested: 600,
      ledgerReady: 2_500,
    });
  });

  it('선택적 prewarm은 첫 ledger paint와 추가 idle 지연 전에는 실행하지 않는다', () => {
    installPerformanceDouble();
    const telemetry = require('@/platform/performance/webStartupPerformance') as typeof import(
      '@/platform/performance/webStartupPerformance'
    );
    const task = jest.fn();

    telemetry.scheduleAfterWebFirstLedgerPaint(task, {
      delayAfterPaintMs: 5_000,
      idleTimeoutMs: 5_000,
    });
    jest.advanceTimersByTime(30_000);
    expect(task).not.toHaveBeenCalled();

    telemetry.markWebFirstLedgerPaint();
    jest.advanceTimersByTime(4_999);
    expect(task).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('앱 사용량 진단은 첫 화면 전체 데이터 paint 전에는 실행하지 않는다', () => {
    installPerformanceDouble();
    const telemetry = require('@/platform/performance/webStartupPerformance') as typeof import(
      '@/platform/performance/webStartupPerformance'
    );
    const task = jest.fn();

    telemetry.scheduleAfterWebFirstHomeCompletePaint(task, {
      idleTimeoutMs: 5_000,
    });
    telemetry.markWebFirstLedgerPaint();
    jest.runAllTimers();
    expect(task).not.toHaveBeenCalled();

    telemetry.markWebFirstHomeCompletePaint();
    jest.runAllTimers();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('선택적 홈 prefetch는 월 원장 paint로 시작하지 않으며 완료 불가 시 fallback이 한 번만 실행된다', () => {
    const performance = installPerformanceDouble();
    const telemetry = require('@/platform/performance/webStartupPerformance') as typeof import(
      '@/platform/performance/webStartupPerformance'
    );
    const task = jest.fn();
    telemetry.scheduleAfterWebFirstHomeCompletePaint(task, { fallbackMs: 15_000 });
    telemetry.markWebFirstLedgerPaint();
    jest.advanceTimersByTime(14_999);
    expect(task).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    jest.runOnlyPendingTimers();
    expect(task).toHaveBeenCalledTimes(1);
    expect(performance.entries.some(entry => entry.name === telemetry.WEB_STARTUP_MARKS.firstHomeCompletePaint)).toBe(false);
    telemetry.markWebFirstHomeCompletePaint();
    jest.runAllTimers();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('다른 route에서 홈 paint가 없어도 fallback이 실행되고 unmount는 그 예약을 취소한다', () => {
    installPerformanceDouble();
    const telemetry = require('@/platform/performance/webStartupPerformance') as typeof import(
      '@/platform/performance/webStartupPerformance'
    );
    const activeTask = jest.fn();
    const cancelledTask = jest.fn();
    telemetry.scheduleAfterWebFirstHomeCompletePaint(activeTask, { fallbackMs: 15_000 });
    const cancel = telemetry.scheduleAfterWebFirstHomeCompletePaint(cancelledTask, { fallbackMs: 15_000 });
    cancel();
    jest.runAllTimers();
    expect(activeTask).toHaveBeenCalledTimes(1);
    expect(cancelledTask).not.toHaveBeenCalled();
  });

  it('전체 홈 paint 후 실행 대기 중 cleanup도 작업과 fallback을 모두 취소한다', () => {
    installPerformanceDouble();
    const telemetry = require('@/platform/performance/webStartupPerformance') as typeof import(
      '@/platform/performance/webStartupPerformance'
    );
    const task = jest.fn();
    const cancel = telemetry.scheduleAfterWebFirstHomeCompletePaint(task, { fallbackMs: 15_000 });
    telemetry.markWebFirstHomeCompletePaint();
    cancel();
    jest.runAllTimers();
    expect(task).not.toHaveBeenCalled();
  });
});
