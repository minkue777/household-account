interface FakeEntry {
  readonly name: string;
  readonly entryType: 'mark' | 'measure';
}

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

    expect(performance.entries).toEqual(expect.arrayContaining([
      { name: telemetry.WEB_STARTUP_MARKS.bootstrapCacheHit, entryType: 'mark' },
      { name: telemetry.WEB_STARTUP_MARKS.authReady, entryType: 'mark' },
      { name: telemetry.WEB_STARTUP_MARKS.membershipReady, entryType: 'mark' },
      { name: telemetry.WEB_STARTUP_MARKS.householdCacheMiss, entryType: 'mark' },
      { name: telemetry.WEB_STARTUP_MARKS.firstLedgerPaint, entryType: 'mark' },
      { name: telemetry.WEB_STARTUP_MEASURES.firstLedgerPaint, entryType: 'measure' },
    ]));
    expect(performance.mark.mock.calls.every((args) => args.length === 1)).toBe(true);
    expect(performance.measure.mock.calls.every((args) => args.length === 3)).toBe(true);
    expect(JSON.stringify(performance.entries)).not.toMatch(/uid|householdId|memberId/i);
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
});
