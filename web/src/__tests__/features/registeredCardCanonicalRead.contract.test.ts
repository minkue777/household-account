const mockCollection = jest.fn((...segments: unknown[]) => ({
  kind: 'collection',
  segments,
}));
const mockOnSnapshot = jest.fn();

jest.mock('@/platform/read-model/firestoreReadModel', () => ({
  db: { kind: 'firestore' },
  collection: (...segments: unknown[]) => mockCollection(...segments),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
}));

jest.mock('@/features/payment-configuration/application/paymentConfigurationCommands', () => ({
  paymentConfigurationCommands: {
    registerCard: jest.fn(),
    deleteCard: jest.fn(),
    updateCard: jest.fn(),
    reorderCards: jest.fn(),
  },
}));

jest.mock('@/composition/clientSessionScope', () => ({
  requireClientSessionScope: () => ({
    householdId: 'household-1',
  }),
}));

import { subscribeToRegisteredCards } from '@/lib/registeredCardService';

interface SnapshotDocument {
  id: string;
  data: () => Record<string, unknown>;
}

function document(id: string, data: Record<string, unknown>): SnapshotDocument {
  return {
    id,
    data: () => data,
  };
}

function listenerArguments() {
  const [, options, next, error] = mockOnSnapshot.mock.calls.at(-1) as [
    unknown,
    { includeMetadataChanges: boolean },
    (snapshot: {
      metadata: { fromCache: boolean };
      docs: SnapshotDocument[];
    }) => void,
    (error: unknown) => void,
  ];

  return { options, next, error };
}

describe('등록 카드 Canonical 조회 계약', () => {
  beforeEach(() => {
    mockCollection.mockClear();
    mockOnSnapshot.mockReset();
    mockOnSnapshot.mockReturnValue(jest.fn());
  });

  test('[T-CARD-005] 이름이 변경되어도 안정적인 가구원 ID로 본인 카드를 표시한다', () => {
    const listener = jest.fn();

    subscribeToRegisteredCards(
      {
        householdId: 'household-janghwi-minji',
        ownerMemberId: 'member-janghwi',
        legacyOwnerName: '장휘',
      },
      listener
    );
    const { options, next } = listenerArguments();

    expect(mockCollection).toHaveBeenCalledWith(
      { kind: 'firestore' },
      'households',
      'household-janghwi-minji',
      'registeredCards'
    );
    expect(options).toEqual({ includeMetadataChanges: true });

    next({
      metadata: { fromCache: false },
      docs: [
        document('nh-card', {
          householdId: 'household-janghwi-minji',
          ownerMemberId: 'member-janghwi',
          owner: '김장휘',
          cardCompanyCode: '농협',
          lastFour: '1234',
          order: 0,
          lifecycle: 'active',
        }),
        document('other-member-card', {
          householdId: 'household-janghwi-minji',
          ownerMemberId: 'member-minji',
          cardCompanyCode: '국민',
          lastFour: '5678',
          order: 1,
          lifecycle: 'active',
        }),
        document('retired-card', {
          householdId: 'household-janghwi-minji',
          ownerMemberId: 'member-janghwi',
          cardCompanyCode: '삼성',
          lastFour: '9999',
          order: 2,
          lifecycle: 'retired',
        }),
      ],
    });

    expect(listener).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'nh-card',
        ownerMemberId: 'member-janghwi',
        owner: '김장휘',
        cardLabel: '농협',
        cardLastFour: '1234',
        orderIndex: 0,
        lifecycle: 'active',
      }),
    ]);
  });

  test('[T-CARD-005] 서버 응답 전 cache-only 빈 목록을 등록 카드 없음으로 확정하지 않는다', () => {
    const listener = jest.fn();

    subscribeToRegisteredCards(
      {
        householdId: 'household-1',
        ownerMemberId: 'member-1',
        legacyOwnerName: '장휘',
      },
      listener
    );
    const { next } = listenerArguments();

    next({
      metadata: { fromCache: true },
      docs: [],
    });
    expect(listener).not.toHaveBeenCalled();

    next({
      metadata: { fromCache: false },
      docs: [],
    });
    expect(listener).toHaveBeenCalledWith([]);
  });

  test('[T-CARD-005] ownerMemberId가 없는 전환기 문서만 현재 표시 이름으로 보완한다', () => {
    const listener = jest.fn();

    subscribeToRegisteredCards(
      {
        householdId: 'household-1',
        ownerMemberId: 'member-1',
        legacyOwnerName: '장휘',
      },
      listener
    );
    const { next } = listenerArguments();

    next({
      metadata: { fromCache: false },
      docs: [
        document('legacy-current-name', {
          householdId: 'household-1',
          owner: '장휘',
          cardLabel: '농협',
          cardLastFour: '1234',
        }),
        document('legacy-old-name', {
          householdId: 'household-1',
          owner: '김장휘',
          cardLabel: '네이버페이',
          cardLastFour: '',
        }),
      ],
    });

    expect(listener).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'legacy-current-name' }),
    ]);
  });

  test('[T-CARD-005] 조회 장애를 빈 카드 목록으로 숨기지 않는다', () => {
    const listener = jest.fn();
    const errorListener = jest.fn();

    subscribeToRegisteredCards(
      {
        householdId: 'household-1',
        ownerMemberId: 'member-1',
        legacyOwnerName: '장휘',
      },
      listener,
      errorListener
    );
    const { error } = listenerArguments();
    const failure = new Error('temporarily unavailable');

    error(failure);

    expect(errorListener).toHaveBeenCalledWith(failure);
    expect(listener).not.toHaveBeenCalled();
  });
});
