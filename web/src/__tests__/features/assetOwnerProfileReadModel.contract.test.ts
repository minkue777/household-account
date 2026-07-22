jest.mock('@/platform/read-model/firestoreReadModel', () => ({
  collection: jest.fn(),
  db: { kind: 'firestore' },
  onSnapshot: jest.fn(),
  timestampToDate: (value: unknown) =>
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
      ? (value as { toDate: () => Date }).toDate()
      : undefined,
}));

import { collection, onSnapshot } from '@/platform/read-model/firestoreReadModel';
import { FirestoreAssetOwnerProfileReadModel } from '@/platform/read-model/firestoreAssetOwnerProfileReadModel';

const mockCollection = collection as jest.MockedFunction<typeof collection>;
const mockOnSnapshot = onSnapshot as jest.MockedFunction<typeof onSnapshot>;

describe('자산 명의자 Firestore 읽기 모델 계약', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('[T-HH-006][HH-011] 활성 명의자를 서버 함수 없이 생성 순서대로 구독한다', () => {
    const reference = { path: 'households/house-1/assetOwnerProfiles' };
    const unsubscribe = jest.fn();
    let publish: ((snapshot: { docs: unknown[] }) => void) | undefined;
    mockCollection.mockReturnValue(reference);
    mockOnSnapshot.mockImplementation((_reference, next) => {
      publish = next;
      return unsubscribe;
    });
    const listener = jest.fn();

    const dispose = new FirestoreAssetOwnerProfileReadModel().subscribeActive(
      'house-1',
      listener
    );
    publish?.({
      docs: [
        {
          id: 'profile-dependent',
          data: () => ({
            displayName: '지아',
            profileType: 'dependent',
            lifecycleState: 'active',
            aggregateVersion: 2,
            createdAt: { toDate: () => new Date('2026-02-01T00:00:00.000Z') },
          }),
        },
        {
          id: 'profile-member-archived',
          data: () => ({
            displayName: '보관 멤버',
            profileType: 'member',
            lifecycleState: 'archived',
            aggregateVersion: 3,
            createdAt: { toDate: () => new Date('2025-12-01T00:00:00.000Z') },
          }),
        },
        {
          id: 'profile-member',
          data: () => ({
            displayName: '민규',
            profileType: 'member',
            linkedMemberId: 'member-1',
            lifecycleState: 'active',
            aggregateVersion: 4,
            createdAt: { toDate: () => new Date('2026-01-01T00:00:00.000Z') },
          }),
        },
      ],
    });

    expect(mockCollection).toHaveBeenCalledWith(
      { kind: 'firestore' },
      'households',
      'house-1',
      'assetOwnerProfiles'
    );
    expect(listener).toHaveBeenCalledWith([
      {
        profileId: 'profile-member',
        householdId: 'house-1',
        displayName: '민규',
        profileType: 'member',
        linkedMemberId: 'member-1',
        lifecycleState: 'active',
        aggregateVersion: 4,
      },
      {
        profileId: 'profile-dependent',
        householdId: 'house-1',
        displayName: '지아',
        profileType: 'dependent',
        lifecycleState: 'active',
        aggregateVersion: 2,
      },
    ]);

    dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  test('[T-HH-006][HH-011] 일시적인 구독 오류가 이미 표시한 명의자를 빈 목록으로 덮지 않는다', () => {
    const errorListener = jest.fn();
    let reject: ((error: Error) => void) | undefined;
    mockCollection.mockReturnValue({});
    mockOnSnapshot.mockImplementation((_reference, _next, error) => {
      reject = error;
      return jest.fn();
    });
    const listener = jest.fn();

    new FirestoreAssetOwnerProfileReadModel().subscribeActive(
      'house-1',
      listener,
      errorListener
    );
    const failure = new Error('temporarily unavailable');
    reject?.(failure);

    expect(errorListener).toHaveBeenCalledWith(failure);
    expect(listener).not.toHaveBeenCalled();
  });
});
