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
const mockPersistentLocalCache = jest.fn(() => mockLocalCache);

jest.mock('firebase/app', () => ({
  initializeApp: mockInitializeApp,
  getApps: mockGetApps,
}));

jest.mock('firebase/firestore', () => ({
  initializeFirestore: mockInitializeFirestore,
  getFirestore: mockGetFirestore,
  persistentSingleTabManager: mockPersistentSingleTabManager,
  persistentLocalCache: mockPersistentLocalCache,
}));

jest.mock('@/platform/android-host/androidHostBridge', () => ({
  isAndroidHostAvailable: () => true,
}));

describe('Android Firestore runtime 계약', () => {
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
});
