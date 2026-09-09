import { searchExpenses, searchExpensePage, subscribeToDateRangeExpenses } from '@/lib/expenseService';
import { getDocsFromServer, onSnapshot, limit } from '@/platform/read-model/firestoreReadModel';
import { ledgerOptimisticProjection } from '@/features/ledger/application/ledgerOptimisticProjection';
import { requireClientSessionScope } from '@/composition/clientSessionScope';

jest.mock('@/composition/clientSessionScope', () => ({
  requireClientSessionScope: jest.fn(() => ({ householdId: 'house-1', memberId: 'member-1', principalUid: 'uid', sessionGeneration: 1 })),
}));

jest.mock('@/platform/read-model/firestoreReadModel', () => ({
  collection: jest.fn(() => ({ kind: 'collection' })),
  query: jest.fn(() => ({ kind: 'query' })),
  where: jest.fn(() => ({ kind: 'where' })),
  limit: jest.fn(), orderBy: jest.fn(), startAfter: jest.fn(), documentId: jest.fn(),
  getDocs: jest.fn(),
  getDocsFromServer: jest.fn(),
  onSnapshot: jest.fn(),
  db: {},
}));

const mockedGetDocs = getDocsFromServer as jest.MockedFunction<typeof getDocsFromServer>;

function ledgerDocument(
  id: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    id,
    data: () => ({
      householdId: 'house-1',
      transactionType: 'expense',
      date: '2026-08-11',
      time: '12:00',
      merchant: 'matched merchant',
      amount: 10_000,
      category: 'etc',
      cardType: 'captured',
      cardDisplay: 'Samsung(3628)',
      aggregateVersion: 1,
      lifecycleState: 'active',
      ...overrides,
    }),
  };
}

describe('ledger search visibility contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireClientSessionScope as jest.Mock).mockReturnValue({ householdId: 'house-1', memberId: 'member-1', principalUid: 'uid', sessionGeneration: 1 });
    ledgerOptimisticProjection.reset();
  });

  test('search pages one bounded source window with whole-result totals and reuses it across keystrokes', async () => {
    mockedGetDocs.mockResolvedValueOnce({ docs: Array.from({ length: 51 }, (_, index) => ledgerDocument(`row-${index}`)) } as Awaited<ReturnType<typeof getDocsFromServer>>);
    const page = await searchExpensePage('merchant', { transactionType: 'expense', sourceWindow: 'window-1' });
    expect(limit).toHaveBeenCalledWith(10_001);
    expect(page.items).toHaveLength(50);
    expect(page.summary).toEqual({ count: 51, amount: 510_000, months: { '2026-08': { count: 51, amount: 510_000 } } });
    const second = await searchExpensePage('merchant', { transactionType: 'expense', cursor: page.nextCursor, sourceWindow: 'window-1' });
    expect(second.items).toHaveLength(1);
    expect(new Set([...page.items, ...second.items].map(item => item.id)).size).toBe(51);
    expect(second.summary).toEqual(page.summary);
    await searchExpensePage('matched', { transactionType: 'expense', sourceWindow: 'window-1' });
    expect(mockedGetDocs).toHaveBeenCalledTimes(1);
    await expect(searchExpensePage('merchant', { transactionType: 'expense', cursor: page.nextCursor, sourceWindow: 'changed-window' })).rejects.toMatchObject({ code: 'SOURCE_WINDOW_CHANGED' });
  });

  test('fails instead of publishing partial totals beyond the safe source bound', async () => {
    mockedGetDocs.mockResolvedValueOnce({ docs: Array.from({ length: 10_001 }, (_, index) => ledgerDocument(`row-${index}`)) } as Awaited<ReturnType<typeof getDocsFromServer>>);
    await expect(searchExpensePage('merchant')).rejects.toMatchObject({
      code: 'SOURCE_LIMIT_EXCEEDED',
      message: '검색할 거래가 많습니다. 검색 기간을 줄여 주세요.',
    });
  });

  test.each(['permission-denied', 'failed-precondition', 'firestore/unavailable'])(
    'exposes only the read stage and safe provider code %s when search fails',
    async (code) => {
      mockedGetDocs.mockRejectedValueOnce(Object.assign(
        new Error('private provider message containing a request token and document contents'),
        { code }
      ));

      await expect(searchExpensePage('merchant')).rejects.toMatchObject({
        code: 'SOURCE_UNAVAILABLE',
        message: `검색 결과를 불러오지 못했습니다. 다시 시도해 주세요. (read/${code})`,
      });
    }
  );

  test.each(['invalid code: private contents', 'a'.repeat(81)])(
    'uses the error name instead of an unsafe provider code',
    async (code) => {
      mockedGetDocs.mockRejectedValueOnce(Object.assign(
        new TypeError('private provider message'),
        { code }
      ));

      await expect(searchExpensePage('merchant')).rejects.toMatchObject({
        code: 'SOURCE_UNAVAILABLE',
        message: '검색 결과를 불러오지 못했습니다. 다시 시도해 주세요. (read/TypeError)',
      });
    }
  );

  test('distinguishes document decoding failures without exposing the original message', async () => {
    mockedGetDocs.mockResolvedValueOnce({
      docs: [{
        id: 'invalid-row',
        data: () => { throw new TypeError('private document contents'); },
      }],
    } as Awaited<ReturnType<typeof getDocsFromServer>>);

    await expect(searchExpensePage('merchant')).rejects.toMatchObject({
      code: 'SOURCE_UNAVAILABLE',
      message: '검색 결과를 불러오지 못했습니다. 다시 시도해 주세요. (map/TypeError)',
    });
  });

  test('drops a response from a previous authenticated session generation', async () => {
    mockedGetDocs.mockImplementationOnce(async () => {
      (requireClientSessionScope as jest.Mock).mockReturnValue({ householdId: 'house-2', memberId: 'member-2', principalUid: 'uid', sessionGeneration: 2 });
      return { docs: [ledgerDocument('old-session')] } as Awaited<ReturnType<typeof getDocsFromServer>>;
    });
    await expect(searchExpensePage('merchant')).rejects.toThrow('세션이 변경');
  });

  test('card search uses original evidence after an unmerge changes the display', async () => {
    mockedGetDocs.mockResolvedValue({ docs: [ledgerDocument('restored', { cardDisplay: '공통카드', cardEvidence: '삼성(3628)' })] } as Awaited<ReturnType<typeof getDocsFromServer>>);
    await expect(searchExpenses('삼성(3628)')).resolves.toEqual([expect.objectContaining({ id: 'restored', cardLastFour: '공통카드', cardEvidence: '삼성(3628)' })]);
  });

  test('range listener failure retains the last successful data and reports the error', () => {
    let receive: (value: unknown) => void = () => {};
    let fail: (error: unknown) => void = () => {};
    (onSnapshot as jest.Mock).mockImplementation((_query, next, error) => { receive = next; fail = error; return jest.fn(); });
    const values: unknown[] = [];
    const onError = jest.fn();
    const dispose = subscribeToDateRangeExpenses('2026-08-01', '2026-08-31', items => values.push(items), { onError });
    receive({ docs: [ledgerDocument('last-success')] });
    const last = values.at(-1);
    const error = new Error('UNAVAILABLE');
    fail(error);
    expect(values.at(-1)).toEqual(last);
    expect((values.at(-1) as Array<{id: string}>)[0].id).toBe('last-success');
    expect(onError).toHaveBeenCalledWith(error);
    dispose();
  });

  test('search returns only active transactions and prefers authoritative categoryId', async () => {
    mockedGetDocs.mockResolvedValue({
      docs: [
        ledgerDocument('active', { categoryId: 'food', category: 'etc' }),
        ledgerDocument('deleted', { lifecycleState: 'deleted' }),
        ledgerDocument('superseded', { lifecycleState: 'superseded' }),
        ledgerDocument('legacy-deleted', {
          lifecycleState: undefined,
          deletedAt: '2026-08-11T12:01:00.000Z',
        }),
      ],
    } as Awaited<ReturnType<typeof getDocsFromServer>>);

    await expect(searchExpenses('merchant')).resolves.toEqual([
      expect.objectContaining({
        id: 'active',
        category: 'food',
      }),
    ]);
  });
});
