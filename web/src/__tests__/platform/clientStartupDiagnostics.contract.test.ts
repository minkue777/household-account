jest.mock('@/platform/android-host/androidHostBridge', () => ({
  isAndroidHostAvailable: jest.fn(() => false),
  requestAndroidHost: jest.fn(),
}));
jest.mock('@/lib/utils/platform', () => ({ Platform: { isIOSPWA: jest.fn(() => true) } }));

describe('iPhone startup diagnostics contract', () => {
  const originalPerformance = window.performance;
  const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  const originalWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
  const originalBuild = process.env.NEXT_PUBLIC_PWA_WORKER_VERSION;
  let clock: number;
  let visible: DocumentVisibilityState;
  let navigation: Partial<PerformanceNavigationTiming>[];
  let resources: Partial<PerformanceResourceTiming>[];
  let entries: { name: string; entryType: string; startTime: number }[];

  function subject() {
    return {
      marks: require('@/platform/performance/webStartupPerformance') as typeof import('@/platform/performance/webStartupPerformance'),
      observation: require('@/platform/performance/clientStartupObservation') as typeof import('@/platform/performance/clientStartupObservation'),
    };
  }
  function changeVisibility(value: DocumentVisibilityState, at: number) {
    clock = at;
    visible = value;
    document.dispatchEvent(new Event('visibilitychange'));
  }

  beforeEach(() => {
    jest.resetModules();
    clock = 100;
    visible = 'visible';
    entries = [];
    navigation = [{ type: 'reload', responseStart: 20, responseEnd: 40, domInteractive: 80 }];
    resources = [];
    Object.defineProperty(window, 'performance', { configurable: true, value: {
      now: jest.fn(() => clock),
      mark: jest.fn((name: string) => entries.push({ name, entryType: 'mark', startTime: clock })),
      measure: jest.fn(),
      getEntriesByName: jest.fn((name: string) => entries.filter((entry) => entry.name === name)),
      getEntriesByType: jest.fn((type: string) => type === 'resource' ? resources : navigation),
    } });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visible });
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { controller: {} } });
    process.env.NEXT_PUBLIC_PWA_WORKER_VERSION = '0123456789abcdef';
  });

  afterEach(() => {
    // 실패한 assertion에서도 문서 listener를 남기지 않습니다.
    const diagnostics = require('@/platform/performance/clientStartupDiagnostics') as typeof import('@/platform/performance/clientStartupDiagnostics');
    try { diagnostics.completeClientStartupDiagnostics(); } catch { /* 미지원 환경 검사 */ }
    Object.defineProperty(window, 'performance', { configurable: true, value: originalPerformance });
    if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility);
    else delete (document as unknown as Record<string, unknown>).visibilityState;
    if (originalWorker) Object.defineProperty(navigator, 'serviceWorker', originalWorker);
    else delete (navigator as unknown as Record<string, unknown>).serviceWorker;
    if (originalBuild === undefined) delete process.env.NEXT_PUBLIC_PWA_WORKER_VERSION;
    else process.env.NEXT_PUBLIC_PWA_WORKER_VERSION = originalBuild;
    jest.restoreAllMocks();
  });

  it.each([true, false])('Android는 두 시계를 분리하고 bridge 대기 전에 Web 진단을 동결한다 (Native 상세 지원=%s)', async nativeDetails => {
    const platform = require('@/lib/utils/platform') as typeof import('@/lib/utils/platform');
    const bridge = require('@/platform/android-host/androidHostBridge') as typeof import('@/platform/android-host/androidHostBridge');
    jest.mocked(platform.Platform.isIOSPWA).mockReturnValue(false);
    jest.mocked(bridge.isAndroidHostAvailable).mockReturnValue(true);
    let finish!: (value: { durationMs: number; startupTimingsMs?: { webViewReady: number; navigationRequested: number } }) => void;
    jest.mocked(bridge.requestAndroidHost).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { marks, observation } = subject();
    const diagnostics = require('@/platform/performance/clientStartupDiagnostics') as typeof import('@/platform/performance/clientStartupDiagnostics');
    marks.markWebBootstrapStarted();
    clock = 200; marks.markWebAuthStarted();
    clock = 300; marks.markWebAuthCompleted(true);
    clock = 350; diagnostics.recordClientStartupTiming('ledgerListenStarted');
    clock = 700; diagnostics.recordClientStartupTiming('ledgerServerSnapshotReceived');
    clock = 800; marks.markWebFirstHomeCompletePaint();
    changeVisibility('hidden', 900);
    clock = 1_000; diagnostics.recordClientStartupTiming('yearSummaryServerSnapshotReceived');
    finish({ durationMs: 2_000, ...(nativeDetails ? { startupTimingsMs: { webViewReady: 90, navigationRequested: 1_100 } } : {}) });
    const result = await observation.readCapturedClientStartupObservation();
    expect(result).toMatchObject({ platform: 'android', durationMs: 2_000, diagnostics: {
      hiddenMs: 0, hiddenCount: 0,
      android: { webDurationMs: 800, bridgeRoundTripMs: 200 },
      timingsMs: { bootstrapStarted: 100, authStarted: 200, authReady: 300,
        ledgerListenStarted: 350, ledgerServerSnapshotReceived: 700, firstHomeCompletePaint: 800 },
    } });
    if (nativeDetails) expect(result?.diagnostics?.android?.nativeTimingsMs).toEqual({ webViewReady: 90, navigationRequested: 1_100 });
    else expect(result?.diagnostics?.android?.nativeTimingsMs).toBeUndefined();
    expect(result?.diagnostics?.timingsMs.yearSummaryServerSnapshotReceived).toBeUndefined();
    expect(await observation.captureClientStartupObservation()).toBe(result);
    expect(bridge.requestAndroidHost).toHaveBeenCalledTimes(1);
  });

  it('실제 단계 callback 시각과 cache 경로를 최초 한 번 보존하고 전체 paint에서 동결한다', async () => {
    const { marks, observation } = subject();
    marks.markWebBootstrapStarted();
    marks.markWebBootstrapCacheResult(true);
    clock = 120; marks.markWebAuthStarted();
    clock = 250; marks.markWebAuthCompleted(false);
    clock = 400; marks.markWebAuthCompleted(true);
    marks.markWebMembershipCacheUsed();
    marks.markWebHouseholdCacheResult(false);
    clock = 450; marks.markWebHouseholdStarted();
    clock = 700; marks.markWebHouseholdCompleted(true);
    clock = 800; marks.markWebHomeReadiness({ ledgerReady: false, categoriesReady: true, currencyReady: false, yearSummaryReady: true, yearSummaryRequired: false });
    clock = 900; marks.markWebHomeReadiness({ ledgerReady: false, categoriesReady: true, currencyReady: true, yearSummaryReady: true, yearSummaryRequired: false });
    clock = 1_000; marks.markWebHomeReadiness({ ledgerReady: true, categoriesReady: true, currencyReady: true, yearSummaryReady: true, yearSummaryRequired: false });
    clock = 1_050; marks.markWebFirstLedgerPaint();
    clock = 1_100; marks.markWebFirstHomeCompletePaint();
    clock = 9_000;
    marks.markWebAuthCompleted(true);
    marks.markWebBootstrapCacheResult(false);
    marks.markWebFirstHomeCompletePaint();
    expect(await observation.readCapturedClientStartupObservation()).toEqual({
      platform: 'ios-pwa', durationMs: 1_100,
      diagnostics: {
        version: 1, webBuild: '0123456789abcdef', navigationType: 'reload',
        initialVisibility: 'visible', visibilityTrackingStartedAtMs: 100,
        hiddenMs: 0, hiddenCount: 0, serviceWorkerControlled: true, yearSummaryRequired: false,
        cache: { bootstrap: 'hit', membership: 'hit', household: 'miss' },
        timingsMs: {
          navigationResponseStart: 20, navigationResponseEnd: 40, domInteractive: 80,
          bootstrapStarted: 100, authStarted: 120, authReady: 400,
          householdStarted: 450, householdReady: 700, categoriesReady: 800,
          localCurrencyReady: 900, ledgerReady: 1_000, homeReady: 1_000,
          firstLedgerPaint: 1_050, firstHomeCompletePaint: 1_100,
        },
      },
    });
  });

  it('초기 hidden과 전환 시간을 bootstrap부터 계산하고 완료 시 listener를 제거한다', async () => {
    visible = 'hidden';
    const remove = jest.spyOn(document, 'removeEventListener');
    const { marks, observation } = subject();
    marks.markWebBootstrapStarted();
    changeVisibility('hidden', 150); // 동일 상태 이벤트는 중복 집계하지 않습니다.
    changeVisibility('visible', 300);
    changeVisibility('hidden', 500);
    clock = 900; marks.markWebFirstHomeCompletePaint();
    changeVisibility('visible', 2_000);
    const result = await observation.readCapturedClientStartupObservation();
    expect(result?.durationMs).toBe(900);
    expect(result?.diagnostics).toMatchObject({ initialVisibility: 'hidden', hiddenCount: 2, hiddenMs: 600, visibilityTrackingStartedAtMs: 100 });
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('연간 합계가 필요한 경우 실제 준비 전에는 homeReady나 yearSummaryReady를 만들지 않는다', async () => {
    const { marks, observation } = subject();
    marks.markWebBootstrapStarted();
    clock = 500; marks.markWebMembershipPrefetched();
    marks.markWebMembershipStarted();
    clock = 600; marks.markWebMembershipCompleted(true);
    marks.markWebHomeReadiness({ ledgerReady: true, categoriesReady: true, currencyReady: true, yearSummaryReady: false, yearSummaryRequired: true });
    expect(entries.some((entry) => entry.name === marks.WEB_STARTUP_MARKS.homeReady)).toBe(false);
    clock = 2_000; marks.markWebHomeReadiness({ ledgerReady: true, categoriesReady: true, currencyReady: true, yearSummaryReady: true, yearSummaryRequired: true });
    clock = 2_100; marks.markWebFirstHomeCompletePaint();
    expect((await observation.readCapturedClientStartupObservation())?.diagnostics).toMatchObject({
      yearSummaryRequired: true, cache: { membership: 'prefetched' },
      timingsMs: { membershipStarted: 500, membershipReady: 600, ledgerReady: 600, yearSummaryReady: 2_000, homeReady: 2_000 },
    });
  });

  it.each([{ provided: [] }, { provided: [{ type: 'navigate' as const, responseStart: 0, responseEnd: 0, domInteractive: 0 }] }])('Navigation Timing 미지원/미완료 값은 0으로 조작하지 않는다 (%j)', async ({ provided }) => {
    navigation = provided;
    process.env.NEXT_PUBLIC_PWA_WORKER_VERSION = 'https://invalid/private';
    const { marks, observation } = subject();
    marks.markWebBootstrapStarted();
    clock = 600; marks.markWebFirstHomeCompletePaint();
    const result = (await observation.readCapturedClientStartupObservation())?.diagnostics;
    expect(result?.timingsMs).toEqual({ bootstrapStarted: 100, firstHomeCompletePaint: 600 });
    expect(result).not.toHaveProperty('webBuild');
  });

  it('부가 환경 API 실패가 기존 총시간 표본을 막지 않는다', async () => {
    const { marks, observation } = subject();
    marks.markWebBootstrapStarted();
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, get: () => { throw new Error('unavailable'); } });
    clock = 600;
    expect(() => marks.markWebFirstHomeCompletePaint()).not.toThrow();
    expect(await observation.readCapturedClientStartupObservation()).toEqual({ platform: 'ios-pwa', durationMs: 600 });
  });

  it('시작 visibility listener 등록 실패도 앱 초기화나 기존 총시간을 막지 않는다', async () => {
    const add = document.addEventListener.bind(document);
    jest.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
      if (type === 'visibilitychange') throw new Error('listener unavailable');
      add(type, listener, options);
    });
    const { marks, observation } = subject();
    expect(() => marks.markWebBootstrapStarted()).not.toThrow();
    clock = 600; marks.markWebFirstHomeCompletePaint();
    expect(await observation.readCapturedClientStartupObservation()).toEqual({ platform: 'ios-pwa', durationMs: 600 });
  });

  it('일반 Web에서는 visibility listener와 앱 진단 표본을 만들지 않는다', async () => {
    const { Platform } = require('@/lib/utils/platform') as typeof import('@/lib/utils/platform');
    jest.mocked(Platform.isIOSPWA).mockReturnValue(false);
    const add = jest.spyOn(document, 'addEventListener');
    const { marks, observation } = subject();
    marks.markWebBootstrapStarted();
    marks.markWebFirstHomeCompletePaint();
    expect(add).not.toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(await observation.readCapturedClientStartupObservation()).toBeUndefined();
  });

  it('완료된 실제 토큰 endpoint의 최초 리소스 구간만 복사하며 원문과 요청 상태를 추정하지 않는다', async () => {
    resources = [
      { name: 'https://securetoken.googleapis.com/v1/token?key=private-key', startTime: 500, responseEnd: 900 },
      { name: 'https://securetoken.googleapis.com/v1/token?key=private-key', startTime: 200, requestStart: 0, responseEnd: 450 },
      { name: 'https://securetoken.googleapis.com.evil.test/v1/token', startTime: 1, responseEnd: 2 },
      { name: 'https://securetoken.googleapis.com/v1/other', startTime: 3, responseEnd: 4 },
      { name: 'https://identitytoolkit.googleapis.com/v1/accounts:lookup', startTime: 5, responseEnd: 6 },
      { name: 'https://securetoken.googleapis.com/v1/token', startTime: 50, responseEnd: 0 },
      { name: 'https://securetoken.googleapis.com/v1/token', startTime: 100, responseEnd: 2_000 },
    ];
    const { marks, observation } = subject();
    marks.markWebBootstrapStarted();
    clock = 1_000; marks.markWebFirstHomeCompletePaint();
    const diagnostics = (await observation.readCapturedClientStartupObservation())?.diagnostics;
    expect(diagnostics?.timingsMs).toMatchObject({ authTokenRequestStarted: 200, authTokenResponseEnd: 450 });
    expect(diagnostics?.timingsMs.authTokenObserved).toBeUndefined();
    expect(JSON.stringify(diagnostics)).not.toMatch(/private-key|googleapis|token\?/);
    resources = [{ name: 'https://securetoken.googleapis.com/v1/token', startTime: 1, responseEnd: 2 }];
    expect((await observation.readCapturedClientStartupObservation())?.diagnostics).toBe(diagnostics);
  });

  it('Resource Timing 조회가 실패해도 기존 진단과 총시간을 유지한다', async () => {
    const { marks, observation } = subject();
    marks.markWebBootstrapStarted();
    jest.mocked(window.performance.getEntriesByType).mockImplementation((type) => {
      if (type === 'resource') throw new Error('resource timing unavailable');
      return navigation as PerformanceEntry[];
    });
    clock = 600; marks.markWebFirstHomeCompletePaint();
    const result = await observation.readCapturedClientStartupObservation();
    expect(result).toMatchObject({ durationMs: 600, diagnostics: { timingsMs: { bootstrapStarted: 100, firstHomeCompletePaint: 600 } } });
    expect(result?.diagnostics?.timingsMs.authTokenRequestStarted).toBeUndefined();
    expect(result?.diagnostics?.timingsMs.authTokenResponseEnd).toBeUndefined();
  });

  it('새 callback 시각은 준비 완료와 분리하고 최초 값만 동결하며 시계 오류는 전파하지 않는다', async () => {
    const { marks, observation } = subject();
    const diagnostics = require('@/platform/performance/clientStartupDiagnostics') as typeof import('@/platform/performance/clientStartupDiagnostics');
    marks.markWebBootstrapStarted();
    clock = 120; diagnostics.recordClientStartupTiming('authTokenObserved');
    clock = 150; diagnostics.recordClientStartupTiming('ledgerListenStarted');
    clock = 400; diagnostics.recordClientStartupTiming('ledgerServerSnapshotReceived');
    clock = 450; diagnostics.recordClientStartupTiming('ledgerServerSnapshotReceived');
    jest.mocked(window.performance.now).mockImplementationOnce(() => { throw new Error('clock unavailable'); });
    expect(() => diagnostics.recordClientStartupTiming('categoriesListenStarted')).not.toThrow();
    clock = 500; marks.markWebHomeReadiness({ ledgerReady: true, categoriesReady: true, currencyReady: true, yearSummaryReady: true, yearSummaryRequired: false });
    clock = 600; marks.markWebFirstHomeCompletePaint();
    clock = 700; diagnostics.recordClientStartupTiming('yearSummaryServerSnapshotReceived');
    expect((await observation.readCapturedClientStartupObservation())?.diagnostics?.timingsMs).toMatchObject({
      authTokenObserved: 120, ledgerListenStarted: 150, ledgerServerSnapshotReceived: 400, ledgerReady: 500,
    });
    expect((await observation.readCapturedClientStartupObservation())?.diagnostics?.timingsMs.categoriesListenStarted).toBeUndefined();
    expect((await observation.readCapturedClientStartupObservation())?.diagnostics?.timingsMs.yearSummaryServerSnapshotReceived).toBeUndefined();
  });
});
