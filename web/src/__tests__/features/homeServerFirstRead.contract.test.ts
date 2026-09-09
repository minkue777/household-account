const mockOnSnapshot = jest.fn();
const mockGetDocsFromServer = jest.fn();
const mockGetDocFromServer = jest.fn();
const mockWhere = jest.fn((...args: unknown[]) => ({ kind: 'where', args }));

jest.mock('@/platform/read-model/firestoreReadModel', () => ({
  db: { kind: 'db' },
  collection: jest.fn((...segments: unknown[]) => ({ kind: 'collection', segments })),
  doc: jest.fn((...segments: unknown[]) => ({ kind: 'document', segments })),
  getDocsFromServer: (...args: unknown[]) => mockGetDocsFromServer(...args),
  getDocFromServer: (...args: unknown[]) => mockGetDocFromServer(...args),
  query: jest.fn((...constraints: unknown[]) => ({ kind: 'query', constraints })),
  where: (...args: unknown[]) => mockWhere(...args),
  orderBy: jest.fn((...args: unknown[]) => ({ kind: 'orderBy', args })),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
  timestampToDate: (value: unknown) => value instanceof Date ? value : undefined,
}));

jest.mock('@/composition/clientSessionScope', () => ({
  requireClientSessionScope: () => ({
    sessionGeneration: 1,
    principalUid: 'uid-1',
    householdId: 'household-1',
    memberId: 'member-1',
    accessMode: 'member',
  }),
}));

jest.mock('@/features/ledger/application/ledgerOptimisticProjection', () => ({
  ledgerOptimisticProjection: {
    subscribe: (
      callback: (items: unknown[]) => void,
      predicate: (item: unknown) => boolean
    ) => ({
      publish: (items: unknown[]) => callback(items.filter(predicate)),
      dispose: jest.fn(),
    }),
  },
}));

import { subscribeToCategories, subscribeToCategoryCatalogVersion } from '@/lib/categoryService';
import {
  readMonthlyTransactionsForPrefetch,
  subscribeToMonthlyTransactions,
} from '@/lib/expenseService';
import { getHousehold } from '@/lib/householdService';

function listenerArguments() {
  const [, options, next, error] = mockOnSnapshot.mock.calls.at(-1) as [
    unknown,
    { includeMetadataChanges: boolean },
    (snapshot: any) => void,
    (error: unknown) => void,
  ];
  return { options, next, error };
}

describe('가계부 첫 화면 server-first 조회 계약', () => {
  beforeEach(() => {
    mockOnSnapshot.mockReset();
    mockOnSnapshot.mockReturnValue(jest.fn());
    mockGetDocsFromServer.mockReset();
    mockGetDocFromServer.mockReset();
    mockWhere.mockClear();
  });

  it('월 원장은 지출과 수입을 하나로 구독하고 cache가 아닌 서버 snapshot부터 방출한다', () => {
    const callback = jest.fn();
    subscribeToMonthlyTransactions(2026, 7, callback);
    const { options, next } = listenerArguments();

    expect(options).toEqual({ includeMetadataChanges: true });
    next({
      metadata: { fromCache: true },
      docs: [{
        id: 'cached-expense',
        data: () => ({
          householdId: 'household-1',
          date: '2026-07-26',
          time: '09:00',
          merchant: '이전 값',
          amount: 1_000,
          category: 'etc',
        }),
      }],
    });
    expect(callback).not.toHaveBeenCalled();

    next({
      metadata: { fromCache: false },
      docs: [{
        id: 'server-expense',
        data: () => ({
          householdId: 'household-1',
          date: '2026-07-26',
          time: '10:00',
          merchant: '최신 값',
          amount: 2_000,
          category: 'etc',
        }),
      }, {
        id: 'server-income',
        data: () => ({
          householdId: 'household-1',
          date: '2026-07-25',
          time: '09:00',
          merchant: '급여',
          amount: 3_000_000,
          category: 'income',
          transactionType: 'income',
        }),
      }, {
        id: 'server-split-part',
        data: () => ({
          householdId: 'household-1',
          date: '2026-07-24',
          time: '08:00',
          merchant: '테스트 (1/2)',
          amount: 1_000,
          category: 'etc',
          splitGroupId: 'split-group-1',
          splitGroup: {
            groupId: 'split-group-1',
            index: 1,
            total: 2,
            originalId: 'server-split-original',
          },
        }),
      }, {
        id: 'server-local-currency-expense',
        data: () => ({
          householdId: 'household-1',
          date: '2026-07-23',
          time: '18:00',
          merchant: '지역화폐 가맹점',
          amount: 5_000,
          category: 'etc',
          cardType: 'captured',
          localCurrencyType: 'gyeonggi',
        }),
      }],
    });
    expect(callback).toHaveBeenLastCalledWith([
      expect.objectContaining({
        id: 'server-expense',
        merchant: '최신 값',
        transactionType: 'expense',
      }),
      expect.objectContaining({
        id: 'server-income',
        merchant: '급여',
        transactionType: 'income',
      }),
      expect.objectContaining({
        id: 'server-split-part',
        splitGroupId: 'split-group-1',
        splitOriginalId: 'server-split-original',
      }),
      expect.objectContaining({
        id: 'server-local-currency-expense',
        cardType: 'captured',
        localCurrencyType: 'gyeonggi',
      }),
    ]);
    expect(mockWhere).not.toHaveBeenCalledWith(
      'transactionType',
      '==',
      expect.anything()
    );
  });

  it('[T-LED-004][LED-010] production-shaped 지역화폐 거래 41건의 유형을 read model에 보존한다', () => {
    const callback = jest.fn();
    subscribeToMonthlyTransactions(2026, 8, callback);
    const { next } = listenerArguments();
    const documents = Array.from({ length: 41 }, (_, index) => ({
      id: `gyeonggi-${index + 1}`,
      data: () => ({
        householdId: 'household-1',
        transactionType: 'expense',
        date: '2026-08-31',
        time: '20:28',
        merchant: `경기 가맹점 ${index + 1}`,
        amount: 1_000 + index,
        categoryId: 'etc',
        cardType: 'captured',
        localCurrencyType: 'gyeonggi',
        lifecycleState: 'active',
        aggregateVersion: 1,
      }),
    }));

    next({ metadata: { fromCache: false }, docs: documents });

    const mapped = callback.mock.calls.at(-1)?.[0] as Array<{
      cardType?: string;
      localCurrencyType?: string;
    }>;
    expect(mapped).toHaveLength(41);
    expect(mapped.every(
      ({ cardType, localCurrencyType }) =>
        cardType === 'captured' && localCurrencyType === 'gyeonggi'
    )).toBe(true);
  });

  it('가구 이름과 구성도 cache가 아닌 서버 document에서 읽는다', async () => {
    mockGetDocFromServer.mockResolvedValue({
      id: 'household-1',
      exists: () => true,
      data: () => ({
        name: '서버 가계부',
        createdAt: new Date('2026-07-26T00:00:00.000Z'),
        members: [{ id: 'member-1', name: '민규', aggregateVersion: 3 }],
      }),
    });

    await expect(getHousehold('household-1')).resolves.toEqual(
      expect.objectContaining({ id: 'household-1', name: '서버 가계부' })
    );
    expect(mockGetDocFromServer).toHaveBeenCalledTimes(1);
  });

  it('인접 월 사전 조회는 listener를 만들지 않는 일회성 조회다', async () => {
    mockGetDocsFromServer.mockResolvedValue({
      docs: [{
        id: 'august-expense',
        data: () => ({
          householdId: 'household-1',
          date: '2026-08-01',
          time: '10:00',
          merchant: '8월 거래',
          amount: 2_000,
          category: 'etc',
        }),
      }],
    });

    await expect(
      readMonthlyTransactionsForPrefetch(2026, 8)
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'august-expense',
        date: '2026-08-01',
      }),
    ]);

    expect(mockGetDocsFromServer).toHaveBeenCalledTimes(1);
    expect(mockOnSnapshot).not.toHaveBeenCalled();
    expect(mockWhere).toHaveBeenCalledWith('date', '>=', '2026-08-01');
    expect(mockWhere).toHaveBeenCalledWith('date', '<=', '2026-08-31');
  });

  it('카테고리도 Firestore cache snapshot을 건너뛰고 서버 snapshot부터 방출한다', () => {
    const callback = jest.fn();
    subscribeToCategories('household-1', callback);
    const { options, next } = listenerArguments();

    expect(options).toEqual({ includeMetadataChanges: true });
    next({
      metadata: { fromCache: true },
      docs: [{
        id: 'cached-category',
        data: () => ({ householdId: 'household-1', key: 'old', label: '이전' }),
      }],
    });
    expect(callback).not.toHaveBeenCalled();

    next({
      metadata: { fromCache: false },
      docs: [{
        id: 'server-category',
        data: () => ({ householdId: 'household-1', key: 'new', label: '최신' }),
      }],
    });
    expect(callback).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'server-category', label: '최신' }),
    ]);
  });

  it('카테고리 카탈로그 버전은 단일 설정 문서의 서버 변경을 구독하고 해제한다', () => {
    const callback = jest.fn();
    const unsubscribe = jest.fn();
    mockOnSnapshot.mockReturnValue(unsubscribe);

    const dispose = subscribeToCategoryCatalogVersion('household-1', callback);
    const { options, next } = listenerArguments();
    expect(mockOnSnapshot.mock.calls[0][0]).toEqual({
      kind: 'document',
      segments: [{ kind: 'db' }, 'households', 'household-1', 'categorySettings', 'default'],
    });
    expect(options).toEqual({ includeMetadataChanges: true });

    next({ metadata: { fromCache: true }, data: () => ({ catalogVersion: 6 }) });
    expect(callback).not.toHaveBeenCalled();
    next({ metadata: { fromCache: false }, data: () => ({ catalogVersion: 7, defaultCategoryId: 'food' }) });
    next({ metadata: { fromCache: true }, data: () => ({ catalogVersion: 6 }) });
    next({ metadata: { fromCache: false }, data: () => ({ catalogVersion: 8 }) });
    expect(callback.mock.calls).toEqual([[7, 'food'], [8, undefined]]);
    expect(mockGetDocFromServer).not.toHaveBeenCalled();
    expect(mockGetDocsFromServer).not.toHaveBeenCalled();

    dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it.each([
    { description: '설정 문서가 없으면', data: undefined, expected: 0 },
    { description: '버전 필드가 없으면', data: {}, expected: 0 },
    { description: 'legacy aggregateVersion만 있으면', data: { aggregateVersion: 4 }, expected: 4 },
  ])('카테고리 카탈로그는 $description 서버 저장소와 같은 버전을 사용한다', ({ data, expected }) => {
    const callback = jest.fn();
    subscribeToCategoryCatalogVersion('household-1', callback);
    listenerArguments().next({ metadata: { fromCache: false }, data: () => data });
    expect(callback).toHaveBeenCalledWith(expected, undefined);
  });

  it('카테고리 카탈로그 권한 오류를 버전 0으로 위장하지 않고 호출자에게 전달한다', () => {
    const callback = jest.fn();
    const onError = jest.fn();
    const denied = Object.assign(new Error('permission denied'), { code: 'permission-denied' });
    subscribeToCategoryCatalogVersion('household-1', callback, onError);
    listenerArguments().error(denied);
    expect(onError).toHaveBeenCalledWith(denied);
    expect(callback).not.toHaveBeenCalled();
  });

  it('손상된 카탈로그 버전은 순서 변경에 전달하지 않는다', () => {
    const callback = jest.fn();
    const onError = jest.fn();
    subscribeToCategoryCatalogVersion('household-1', callback, onError);
    listenerArguments().next({ metadata: { fromCache: false }, data: () => ({ catalogVersion: -1 }) });
    expect(callback).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });
});
