jest.mock('@/platform/android-host/androidHostBridge', () => ({
  isAndroidHostAvailable: jest.fn(),
  requestAndroidHost: jest.fn(),
}));

jest.mock('@/lib/utils/platform', () => ({
  Platform: {
    isIOSPWA: jest.fn(),
  },
}));

describe('client startup observation contract', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    { webViewReady: -1 }, { navigationRequested: 2_001 },
    { webViewReady: 800, navigationRequested: 700 }, { url: 'https://private' },
  ])('손상 Native 상세 값은 생략하되 기존 총시간과 Web 구간은 보존한다: %j', async native => {
    const bridge = require('@/platform/android-host/androidHostBridge') as typeof import('@/platform/android-host/androidHostBridge');
    jest.mocked(bridge.isAndroidHostAvailable).mockReturnValue(true);
    jest.mocked(bridge.requestAndroidHost).mockResolvedValue({ durationMs: 2_000, startupTimingsMs: native });
    const clock = jest.spyOn(window.performance, 'now').mockReturnValue(100);
    const diagnostics = require('@/platform/performance/clientStartupDiagnostics') as typeof import('@/platform/performance/clientStartupDiagnostics');
    diagnostics.startClientStartupDiagnostics();
    clock.mockReturnValue(500);
    const subject = require('@/platform/performance/clientStartupObservation') as typeof import('@/platform/performance/clientStartupObservation');
    const result = await subject.captureClientStartupObservation();
    expect(result).toMatchObject({ platform: 'android', durationMs: 2_000, diagnostics: {
      android: { webDurationMs: 500, bridgeRoundTripMs: 0 }, timingsMs: { bootstrapStarted: 100 },
    } });
    expect(result?.diagnostics?.android?.nativeTimingsMs).toBeUndefined();
  });

  it('Android는 Web navigation이 아니라 Activity 생성부터의 Native 시간을 사용한다', async () => {
    const bridge = require(
      '@/platform/android-host/androidHostBridge'
    ) as typeof import('@/platform/android-host/androidHostBridge');
    jest.mocked(bridge.isAndroidHostAvailable).mockReturnValue(true);
    jest.mocked(bridge.requestAndroidHost).mockResolvedValue({
      durationMs: 3_245.6784,
    });

    const subject = require(
      '@/platform/performance/clientStartupObservation'
    ) as typeof import('@/platform/performance/clientStartupObservation');

    await expect(subject.captureClientStartupObservation()).resolves.toEqual({
      platform: 'android',
      durationMs: 3_245.678,
    });
    await subject.captureClientStartupObservation();

    expect(bridge.requestAndroidHost).toHaveBeenCalledTimes(1);
    expect(bridge.requestAndroidHost).toHaveBeenCalledWith(
      'performance.get-app-launch-duration',
      {}
    );
  });

  it('iPhone 홈 화면 PWA는 navigation 시작부터의 browser monotonic 시간을 사용한다', async () => {
    const bridge = require(
      '@/platform/android-host/androidHostBridge'
    ) as typeof import('@/platform/android-host/androidHostBridge');
    const platform = require(
      '@/lib/utils/platform'
    ) as typeof import('@/lib/utils/platform');
    jest.mocked(bridge.isAndroidHostAvailable).mockReturnValue(false);
    jest.mocked(platform.Platform.isIOSPWA).mockReturnValue(true);
    jest.spyOn(window.performance, 'now').mockReturnValue(2_876.4321);

    const subject = require(
      '@/platform/performance/clientStartupObservation'
    ) as typeof import('@/platform/performance/clientStartupObservation');

    await expect(subject.captureClientStartupObservation()).resolves.toEqual({
      platform: 'ios-pwa',
      durationMs: 2_876.432,
    });
    expect(bridge.requestAndroidHost).not.toHaveBeenCalled();
  });

  it('일반 Web 브라우저 접속은 모바일 앱 시작 통계에 섞지 않는다', async () => {
    const bridge = require(
      '@/platform/android-host/androidHostBridge'
    ) as typeof import('@/platform/android-host/androidHostBridge');
    const platform = require(
      '@/lib/utils/platform'
    ) as typeof import('@/lib/utils/platform');
    jest.mocked(bridge.isAndroidHostAvailable).mockReturnValue(false);
    jest.mocked(platform.Platform.isIOSPWA).mockReturnValue(false);

    const subject = require(
      '@/platform/performance/clientStartupObservation'
    ) as typeof import('@/platform/performance/clientStartupObservation');

    await expect(subject.captureClientStartupObservation()).resolves.toBeUndefined();
  });

  it('구 APK 또는 같은 Activity의 이미 소비된 시작 시간은 성공 표본으로 만들지 않는다', async () => {
    const bridge = require(
      '@/platform/android-host/androidHostBridge'
    ) as typeof import('@/platform/android-host/androidHostBridge');
    jest.mocked(bridge.isAndroidHostAvailable).mockReturnValue(true);
    jest.mocked(bridge.requestAndroidHost).mockResolvedValue({
      durationMs: null,
    });

    const subject = require(
      '@/platform/performance/clientStartupObservation'
    ) as typeof import('@/platform/performance/clientStartupObservation');

    await expect(subject.captureClientStartupObservation()).resolves.toBeUndefined();
  });

  it('2분을 넘긴 초기 설정 흐름은 일반 앱 시작 성공 표본에 섞지 않는다', async () => {
    const bridge = require(
      '@/platform/android-host/androidHostBridge'
    ) as typeof import('@/platform/android-host/androidHostBridge');
    jest.mocked(bridge.isAndroidHostAvailable).mockReturnValue(true);
    jest.mocked(bridge.requestAndroidHost).mockResolvedValue({
      durationMs: 120_001,
    });

    const subject = require(
      '@/platform/performance/clientStartupObservation'
    ) as typeof import('@/platform/performance/clientStartupObservation');

    await expect(subject.captureClientStartupObservation()).resolves.toBeUndefined();
  });

  it('Native 계측 실패는 성공 표본이나 화면 오류로 바꾸지 않고 중복 요청도 하지 않는다', async () => {
    const bridge = require(
      '@/platform/android-host/androidHostBridge'
    ) as typeof import('@/platform/android-host/androidHostBridge');
    jest.mocked(bridge.isAndroidHostAvailable).mockReturnValue(true);
    jest.mocked(bridge.requestAndroidHost).mockRejectedValue(new Error('bridge unavailable'));
    const subject = require(
      '@/platform/performance/clientStartupObservation'
    ) as typeof import('@/platform/performance/clientStartupObservation');

    const first = subject.captureClientStartupObservation();
    expect(subject.captureClientStartupObservation()).toBe(first);
    await expect(first).resolves.toBeUndefined();
    await expect(subject.readCapturedClientStartupObservation()).resolves.toBeUndefined();
    expect(bridge.requestAndroidHost).toHaveBeenCalledTimes(1);
  });
});
