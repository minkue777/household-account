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

import { onSnapshot } from '@/platform/read-model/firestoreReadModel';

describe('Firestore listener 인증 복구 경계 계약', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFirebaseOnSnapshot.mockReturnValue(jest.fn());
    mockRequestMembershipResolution.mockReturnValue(false);
  });

  it('listener의 permission-denied는 Membership 복구만 시작해 Android 인증 복구와 경합하지 않는다', () => {
    mockRequestMembershipResolution.mockReturnValue(true);
    const originalError = jest.fn();
    const subscribe = onSnapshot as unknown as (
      query: unknown,
      next: (snapshot: unknown) => void,
      error: (failure: unknown) => void
    ) => () => void;

    subscribe({}, jest.fn(), originalError);
    const wrappedError = mockFirebaseOnSnapshot.mock.calls[0][2] as (
      error: unknown
    ) => void;
    const failure = { code: 'firestore/permission-denied' };
    wrappedError(failure);

    expect(mockRequestMembershipResolution).toHaveBeenCalledWith(failure);
    expect(mockRequestRemoteSessionRecovery).not.toHaveBeenCalled();
    expect(originalError).toHaveBeenCalledWith(failure);
  });

  it('Membership 권한 오류가 아닌 listener 실패는 Android 원격 인증 복구 경계로 전달한다', () => {
    const subscribe = onSnapshot as unknown as (
      query: unknown,
      next: (snapshot: unknown) => void,
      error: (failure: unknown) => void
    ) => () => void;

    subscribe({}, jest.fn(), jest.fn());
    const wrappedError = mockFirebaseOnSnapshot.mock.calls[0][2] as (
      error: unknown
    ) => void;
    const failure = { code: 'firestore/unauthenticated' };
    wrappedError(failure);

    expect(mockRequestMembershipResolution).toHaveBeenCalledWith(failure);
    expect(mockRequestRemoteSessionRecovery).toHaveBeenCalledTimes(1);
  });
});
