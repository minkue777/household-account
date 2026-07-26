const mockOnSnapshot = jest.fn();
const mockGetDocFromServer = jest.fn();

jest.mock('@/platform/read-model/firestoreReadModel', () => ({
  db: { kind: 'db' },
  collection: jest.fn((...segments: unknown[]) => ({ kind: 'collection', segments })),
  doc: jest.fn((...segments: unknown[]) => ({ kind: 'document', segments })),
  getDocFromServer: (...args: unknown[]) => mockGetDocFromServer(...args),
  query: jest.fn((...constraints: unknown[]) => ({ kind: 'query', constraints })),
  where: jest.fn((...args: unknown[]) => ({ kind: 'where', args })),
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
      callback: (items: unknown[]) => void
    ) => ({
      publish: callback,
      dispose: jest.fn(),
    }),
  },
}));

import { subscribeToCategories } from '@/lib/categoryService';
import { subscribeToMonthlyExpenses } from '@/lib/expenseService';
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
    mockGetDocFromServer.mockReset();
  });

  it('월 원장은 Firestore cache snapshot을 표시하지 않고 서버 snapshot부터 방출한다', () => {
    const callback = jest.fn();
    subscribeToMonthlyExpenses(2026, 7, callback, { transactionType: 'expense' });
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
      }],
    });
    expect(callback).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'server-expense', merchant: '최신 값' }),
    ]);
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
});
