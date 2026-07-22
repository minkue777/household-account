const mockApp = { name: 'web-app' };
const mockDb = { runtime: 'android-persistent-firestore' };
const mockTabManager = { kind: 'single-tab' };
const mockLocalCache = { kind: 'persistent-local-cache' };
const mockInitializeApp = jest.fn(() => mockApp);
const mockGetApps = jest.fn((): unknown[] => []);
const mockInitializeFirestore = jest.fn(
  (_app: unknown, _settings: Record<string, unknown>) => mockDb,
);
const mockGetFirestore = jest.fn(() => ({ runtime: 'default-firestore' }));
const mockPersistentSingleTabManager = jest.fn(() => mockTabManager);
const mockPersistentMultipleTabManager = jest.fn(() => ({ kind: 'multiple-tab' }));
const mockPersistentLocalCache = jest.fn(() => mockLocalCache);

jest.mock('firebase/app', () => ({
  initializeApp: mockInitializeApp,
  getApps: mockGetApps,
}));

jest.mock('firebase/firestore', () => ({
  initializeFirestore: mockInitializeFirestore,
  getFirestore: mockGetFirestore,
  persistentMultipleTabManager: mockPersistentMultipleTabManager,
  persistentSingleTabManager: mockPersistentSingleTabManager,
  persistentLocalCache: mockPersistentLocalCache,
}));

let mockAndroidHostAvailable = true;
jest.mock('@/platform/android-host/androidHostBridge', () => ({
  isAndroidHostAvailable: () => mockAndroidHostAvailable,
}));

describe('Android Firestore runtime 계약', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockAndroidHostAvailable = true;
  });

  it('[T-WEBVIEW-004][AND-012] 기본 realtime 전송을 유지하고 Android에만 single-tab persistent cache를 설정한다', async () => {
    await import('@/lib/firebase');

    expect(mockPersistentSingleTabManager).toHaveBeenCalledWith(undefined);
    expect(mockPersistentLocalCache).toHaveBeenCalledWith({
      tabManager: mockTabManager,
    });
    expect(mockInitializeFirestore).toHaveBeenCalledWith(mockApp, {
      localCache: mockLocalCache,
    });
    const settings = mockInitializeFirestore.mock.calls[0]?.[1];
    expect(settings).not.toHaveProperty('experimentalForceLongPolling');
    expect(settings).not.toHaveProperty('experimentalAutoDetectLongPolling');
    expect(mockGetFirestore).not.toHaveBeenCalled();
  });

  it('[AND-012] 브라우저와 iPhone PWA도 multiple-tab persistent cache를 사용한다', async () => {
    mockAndroidHostAvailable = false;
    const multipleTabManager = { kind: 'multiple-tab' };
    mockPersistentMultipleTabManager.mockReturnValue(multipleTabManager);

    await import('@/lib/firebase');

    expect(mockPersistentMultipleTabManager).toHaveBeenCalledTimes(1);
    expect(mockPersistentSingleTabManager).not.toHaveBeenCalled();
    expect(mockPersistentLocalCache).toHaveBeenCalledWith({
      tabManager: multipleTabManager,
    });
    expect(mockInitializeFirestore).toHaveBeenCalledWith(mockApp, {
      localCache: mockLocalCache,
    });
  });
});
