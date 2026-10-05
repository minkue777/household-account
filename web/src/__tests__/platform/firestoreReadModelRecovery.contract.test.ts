const mockFirebaseOnSnapshot = jest.fn();
jest.mock('firebase/firestore', () => ({
  Timestamp: class Timestamp {},
  collection: jest.fn(),
  doc: jest.fn(),
  getDoc: jest.fn(),
  getDocFromServer: jest.fn(),
  getDocs: jest.fn(),
  onSnapshot: (...args: unknown[]) => mockFirebaseOnSnapshot(...args),
  orderBy: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
}));

const mockRequestMembershipResolution = jest.fn();
jest.mock('@/features/access-household/application/membershipResolutionRecovery', () => ({
  requestMembershipResolution: (error: unknown) =>
    mockRequestMembershipResolution(error),
}));

const mockRequestRemoteSessionRecovery = jest.fn();
jest.mock('@/platform/functions-api/firebaseCallableRecovery', () => ({
  requestRemoteSessionRecovery: () => mockRequestRemoteSessionRecovery(),
}));

jest.mock('@/lib/firebase', () => ({ db: {} }));

import { onSnapshot, onDocumentSnapshot, collection, doc, db } from '@/platform/read-model/firestoreReadModel';

describe.each(['query', 'document'])('Firestore %s listener 인증 복구 경계', kind => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFirebaseOnSnapshot.mockReturnValue(jest.fn());
    mockRequestMembershipResolution.mockReturnValue(false);
  });

  function subscribe(next: jest.Mock, error?: jest.Mock) {
    return kind === 'query'
      ? onSnapshot(collection(db, 'households'), { includeMetadataChanges: true }, next, error)
      : onDocumentSnapshot(doc(db, 'households', 'one'), { includeMetadataChanges: true }, next, error);
  }

  test.each(['permission-denied', 'firestore/permission-denied'])('%s는 Membership 복구만 시작한다', code => {
    mockRequestMembershipResolution.mockReturnValue(true);
    const failed = jest.fn();
    subscribe(jest.fn(), failed);
    const failure = { code };
    mockFirebaseOnSnapshot.mock.calls[0][3](failure);
    expect(mockRequestMembershipResolution).toHaveBeenCalledWith(failure);
    expect(mockRequestRemoteSessionRecovery).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledWith(failure);
  });

  test.each(['unauthenticated', 'firestore/unauthenticated', 'unavailable', 'deadline-exceeded', 'failed-precondition', 'internal'])('%s 오류를 전달하며 인증 만료만 원격 세션을 복구한다', code => {
    const next = jest.fn(), failed = jest.fn();
    const stop = subscribe(next, failed);
    const failure = { code };
    const [, options, callback, error] = mockFirebaseOnSnapshot.mock.calls[0];
    expect(options).toEqual({ includeMetadataChanges: true });
    expect(callback).toBe(next);
    error(failure);
    expect(failed).toHaveBeenCalledWith(failure);
    expect(mockRequestRemoteSessionRecovery).toHaveBeenCalledTimes(code.endsWith('unauthenticated') ? 1 : 0);
    stop();
    expect(mockFirebaseOnSnapshot.mock.results[0].value).toHaveBeenCalledTimes(1);
  });

  test('오류 callback 없는 구독도 복구를 요청한다', () => {
    subscribe(jest.fn());
    expect(() => mockFirebaseOnSnapshot.mock.calls[0][3]({ code: 'unauthenticated' })).not.toThrow();
    expect(mockRequestRemoteSessionRecovery).toHaveBeenCalledTimes(1);
  });
});
