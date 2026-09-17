export {};

const mockSharedApp = { name: 'existing-auth-app' };
const mockLiteDb = { runtime: 'server-read-firestore' };
const mockGetFirestore = jest.fn(() => mockLiteDb);
const mockConnectFirestoreEmulator = jest.fn();
const mockGetDocs = jest.fn();
let mockUseEmulator = false;

jest.mock('@/lib/firebaseApp', () => ({ app: mockSharedApp }));
jest.mock('@/platform/firebase/firebaseEmulatorConfig', () => ({
  shouldConnectFirebaseEmulators: () => mockUseEmulator,
  firebaseEmulatorHosts: { firestore: { host: '127.0.0.1', port: 8080 } },
}));
jest.mock('firebase/firestore/lite', () => ({
  getFirestore: mockGetFirestore,
  connectFirestoreEmulator: mockConnectFirestoreEmulator,
  getDocs: mockGetDocs,
}));
jest.mock('firebase/firestore', () => {
  throw new Error('The server read boundary must not initialize or replace realtime Firestore.');
});

type EmulatorRuntime = typeof globalThis & {
  __householdAccountFirebaseEmulators?: { firestore?: boolean; firestoreServer?: boolean };
};
const runtime = globalThis as EmulatorRuntime;

describe('단발 Firestore 서버 조회 경계', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockUseEmulator = false;
    delete runtime.__householdAccountFirebaseEmulators;
  });
  afterEach(() => { delete runtime.__householdAccountFirebaseEmulators; });

  test('기존 Auth의 FirebaseApp을 사용하며 realtime 인스턴스 설정을 불러오지 않는다', async () => {
    const server = await import('@/platform/read-model/firestoreServerReadModel');
    expect(mockGetFirestore).toHaveBeenCalledWith(mockSharedApp);
    expect(server.db).toBe(mockLiteDb);
    expect(mockConnectFirestoreEmulator).not.toHaveBeenCalled();
  });

  test('서버 조회는 Lite 응답과 실패를 그대로 전달하고 writer를 노출하지 않는다', async () => {
    const server = await import('@/platform/read-model/firestoreServerReadModel');
    const query = {} as Parameters<typeof server.getDocsFromServer>[0];
    const result = { docs: [{ id: 'row-1', data: () => ({ amount: 12000 }) }] };
    mockGetDocs.mockResolvedValueOnce(result);
    await expect(server.getDocsFromServer(query)).resolves.toBe(result);
    const denied = Object.assign(new Error('denied'), { code: 'permission-denied' });
    mockGetDocs.mockRejectedValueOnce(denied);
    await expect(server.getDocsFromServer(query)).rejects.toBe(denied);
    for (const name of ['addDoc', 'setDoc', 'updateDoc', 'deleteDoc', 'writeBatch', 'runTransaction']) {
      expect(server).not.toHaveProperty(name);
    }
  });

  test('Full SDK가 이미 Emulator에 연결됐어도 Lite를 별도로 한 번 연결한다', async () => {
    mockUseEmulator = true;
    runtime.__householdAccountFirebaseEmulators = { firestore: true };
    await import('@/platform/read-model/firestoreServerReadModel');
    expect(mockConnectFirestoreEmulator).toHaveBeenCalledWith(mockLiteDb, '127.0.0.1', 8080);
    expect(runtime.__householdAccountFirebaseEmulators).toEqual({ firestore: true, firestoreServer: true });
    jest.resetModules();
    await import('@/platform/read-model/firestoreServerReadModel');
    expect(mockConnectFirestoreEmulator).toHaveBeenCalledTimes(1);
  });
});
