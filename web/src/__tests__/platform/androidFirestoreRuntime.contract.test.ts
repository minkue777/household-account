const mockApp = { name: 'web-app' };
const mockDb = { runtime: 'configured-firestore' };
const mockLocalCache = { kind: 'persistent-local-cache' };
const mockMemoryCache = { kind: 'memory-local-cache' };
const mockInitializeApp = jest.fn(() => mockApp);
const mockGetApps = jest.fn((): unknown[] => []);
const mockInitializeFirestore = jest.fn(
  (_app: unknown, _settings: Record<string, unknown>) => mockDb,
);
const mockGetFirestore = jest.fn(() => ({ runtime: 'default-firestore' }));
const mockPersistentMultipleTabManager = jest.fn(() => ({ kind: 'multiple-tab' }));
const mockPersistentLocalCache = jest.fn(() => mockLocalCache);
const mockMemoryLocalCache = jest.fn(() => mockMemoryCache);

jest.mock('firebase/app', () => ({
  initializeApp: mockInitializeApp,
  getApps: mockGetApps,
}));

jest.mock('firebase/firestore', () => ({
  initializeFirestore: mockInitializeFirestore,
  getFirestore: mockGetFirestore,
  memoryLocalCache: mockMemoryLocalCache,
  persistentMultipleTabManager: mockPersistentMultipleTabManager,
  persistentLocalCache: mockPersistentLocalCache,
}));

let mockAndroidHostAvailable = true;
let mockIOSPWA = false;
jest.mock('@/platform/android-host/androidHostBridge', () => ({
  isAndroidHostAvailable: () => mockAndroidHostAvailable,
}));
jest.mock('@/lib/utils/platform', () => ({
  Platform: { isIOSPWA: () => mockIOSPWA },
}));

describe('Android Firestore runtime 계약', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockAndroidHostAvailable = true;
    mockIOSPWA = false;
  });

  it('[T-WEBVIEW-004][AND-012] 기본 realtime 전송을 유지하고 Android는 memory cache를 사용한다', async () => {
    await import('@/lib/firebase');

    expect(mockMemoryLocalCache).toHaveBeenCalledTimes(1);
    expect(mockPersistentLocalCache).not.toHaveBeenCalled();
    expect(mockInitializeFirestore).toHaveBeenCalledWith(mockApp, {
      localCache: mockMemoryCache,
    });
    const settings = mockInitializeFirestore.mock.calls[0]?.[1];
    expect(settings).not.toHaveProperty('experimentalForceLongPolling');
    expect(settings).not.toHaveProperty('experimentalAutoDetectLongPolling');
    expect(mockGetFirestore).not.toHaveBeenCalled();
  });

  it('[AND-012] iPhone PWA는 영속 cache를 유지하면서 응답 완료 지연을 피하는 long-polling을 사용한다', async () => {
    mockAndroidHostAvailable = false;
    mockIOSPWA = true;

    await import('@/lib/firebase');

    expect(mockMemoryLocalCache).not.toHaveBeenCalled();
    expect(mockPersistentLocalCache).toHaveBeenCalledTimes(1);
    expect(mockPersistentMultipleTabManager).toHaveBeenCalledTimes(1);
    expect(mockInitializeFirestore).toHaveBeenCalledWith(mockApp, {
      localCache: mockLocalCache,
      experimentalForceLongPolling: true,
    });
  });

  it('[AND-012] 일반 브라우저는 multiple-tab persistent cache를 유지한다', async () => {
    mockAndroidHostAvailable = false;
    const multipleTabManager = { kind: 'multiple-tab' };
    mockPersistentMultipleTabManager.mockReturnValue(multipleTabManager);

    await import('@/lib/firebase');

    expect(mockPersistentMultipleTabManager).toHaveBeenCalledTimes(1);
    expect(mockMemoryLocalCache).not.toHaveBeenCalled();
    expect(mockPersistentLocalCache).toHaveBeenCalledWith({
      tabManager: multipleTabManager,
    });
    expect(mockInitializeFirestore).toHaveBeenCalledWith(mockApp, {
      localCache: mockLocalCache,
    });
  });
});
