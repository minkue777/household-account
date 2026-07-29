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
});
