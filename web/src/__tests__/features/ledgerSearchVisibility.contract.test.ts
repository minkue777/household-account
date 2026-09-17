import { searchExpenses, searchExpensePage, subscribeToDateRangeExpenses, prepareExpenseSearchWindow, closeExpenseSearchWindow, createExpenseSearchMatcher, expenseMatchesSearch } from '@/lib/expenseService';
import type { Expense } from '@/types/expense';
import { onSnapshot } from '@/platform/read-model/firestoreReadModel';
import { getDocsFromServer, limit, where, orderBy, documentId } from '@/platform/read-model/firestoreServerReadModel';
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
jest.mock('@/platform/read-model/firestoreServerReadModel', () => ({
  collection: jest.fn(() => ({ kind: 'collection' })),
  query: jest.fn(() => ({ kind: 'query' })),
  where: jest.fn(() => ({ kind: 'where' })),
  limit: jest.fn(), orderBy: jest.fn(), documentId: jest.fn(),
  getDocsFromServer: jest.fn(), db: {},
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

  test.each<{
    keyword: string | null | undefined;
    fields: Record<string, unknown>;
    expected: boolean;
  }>([
    { keyword: null, fields: {}, expected: false },
    { keyword: undefined, fields: {}, expected: false },
    { keyword: ' \t ', fields: {}, expected: false },
    { keyword: ' CAFE ', fields: { merchant: 'Blue CaFe' }, expected: true },
    { keyword: ' 도서 ', fields: { memo: '도서 구입' }, expected: true },
    { keyword: '성능원장', fields: { merchant: '성능 원장' }, expected: false },
    { keyword: '없는 값', fields: { merchant: null, memo: null, cardLastFour: null, cardEvidence: null }, expected: false },
    { keyword: '수동', fields: { merchant: null, cardType: 'manual' }, expected: true },
    { keyword: '경 기 지 역', fields: { cardLastFour: '경기지역화폐(0001)' }, expected: true },
    { keyword: '  k B ( 18** )  ', fields: { cardLastFour: '국민카드(1840)' }, expected: true },
    { keyword: '삼성(3628)', fields: { cardLastFour: '삼성(9999)' }, expected: false },
    { keyword: '삼성(3628)', fields: { cardLastFour: '국민(3628)' }, expected: false },
    { keyword: '삼성(3628)', fields: { cardLastFour: '공통카드', cardEvidence: '삼성(3628)' }, expected: true },
    { keyword: '국민(3628)', fields: { cardLastFour: '국민(3628)', cardEvidence: '삼성(3628)' }, expected: false },
    { keyword: '삼성(36X8)', fields: { cardLastFour: '삼성(3628)' }, expected: true },
    { keyword: '삼성(3628)', fields: { cardLastFour: '삼성(36＊8)' }, expected: true },
    { keyword: '삼성(3***)', fields: { cardLastFour: '삼성(3999)' }, expected: true },
    { keyword: '삼성(3***)', fields: { cardLastFour: '국민(3999)' }, expected: false },
    { keyword: 'KB국민(18**)', fields: { cardLastFour: 'KB(18**)' }, expected: true },
    { keyword: 'Partner(1234)', fields: { cardLastFour: 'Partner(1234)' }, expected: true },
    { keyword: 'Partner(12**)', fields: { cardLastFour: 'Partner(1234)' }, expected: false },
    { keyword: '1234', fields: { cardLastFour: 'KB(1234)' }, expected: true },
    { keyword: '1234', fields: { cardLastFour: 'KB(12**)' }, expected: false },
  ])('prepared matcher and compatibility API retain existing text/card matching: $keyword / $fields', ({ keyword, fields, expected }) => {
    const expense = { id: 'row', aggregateVersion: 1, date: '2026-09-01', amount: 10,
      merchant: '', memo: '', category: 'food', ...fields } as Expense;
    expect(createExpenseSearchMatcher(keyword as string)(expense)).toBe(expected);
    expect(expenseMatchesSearch(expense, keyword as string)).toBe(expected);
  });

  test('a prepared matcher reads current memo and card evidence rather than retaining row search data', () => {
    const expense: Expense = { id: 'row', aggregateVersion: 1, date: '2026-09-01', amount: 10,
      merchant: '가게', category: 'food', memo: '이전 메모', cardLastFour: '국민(3628)' };
    const matchesMemo = createExpenseSearchMatcher('변경된 메모');
    const matchesCard = createExpenseSearchMatcher('삼성(3628)');
    expect(matchesMemo(expense)).toBe(false);
    expect(matchesCard(expense)).toBe(false);
    expense.memo = '변경된 메모';
    expense.cardEvidence = '삼성(3628)';
    expect(matchesMemo(expense)).toBe(true);
    expect(matchesCard(expense)).toBe(true);
    expense.memo = '';
    expense.cardEvidence = undefined;
    expect(matchesMemo(expense)).toBe(false);
    expect(matchesCard(expense)).toBe(false);
  });

  test('search pages one bounded source window with whole-result totals and reuses it across keystrokes', async () => {
    mockedGetDocs.mockResolvedValueOnce({ docs: Array.from({ length: 51 }, (_, index) => ledgerDocument(`row-${index}`)) } as Awaited<ReturnType<typeof getDocsFromServer>>);
    const page = await searchExpensePage('merchant', { transactionType: 'expense', sourceWindow: 'window-1' });
    expect(limit).toHaveBeenCalledWith(10_000);
    expect((where as jest.Mock).mock.calls).toEqual([['householdId', '==', 'house-1']]);
    expect(orderBy).not.toHaveBeenCalled();
    expect(documentId).not.toHaveBeenCalled();
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

  test('opening and typing share the same in-flight full source, including memo, card evidence and every month', async () => {
    let resolveSource!: (snapshot: Awaited<ReturnType<typeof getDocsFromServer>>) => void;
    let sourceStarted!: () => void;
    const started = new Promise<void>(resolve => { sourceStarted = resolve; });
    mockedGetDocs.mockImplementationOnce(() => { sourceStarted(); return new Promise(resolve => { resolveSource = resolve; }); });
    const preparation = prepareExpenseSearchWindow('prepared-window');
    const search = searchExpensePage('삼성(3***)', { transactionType: 'expense', sourceWindow: 'prepared-window' });
    await started;
    expect(mockedGetDocs).toHaveBeenCalledTimes(1);
    resolveSource({ docs: [
      ledgerDocument('older', { date: '2024-01-01', memo: '지난 기록', cardEvidence: '삼성(3628)' }),
      ledgerDocument('latest', { date: '2026-09-17', cardEvidence: '삼성(3999)' }),
      ledgerDocument('other-card', { cardEvidence: '국민(3999)' }),
      ledgerDocument('other-type', { transactionType: 'income', cardEvidence: '삼성(3999)' }),
      ledgerDocument('deleted', { lifecycleState: 'deleted', cardEvidence: '삼성(3999)' }),
    ] } as Awaited<ReturnType<typeof getDocsFromServer>>);
    await preparation;
    const page = await search;
    expect(page.items.map(item => item.id)).toEqual(['latest', 'older']);
    expect(page.summary).toEqual({ count: 2, amount: 20_000, months: {
      '2026-09': { count: 1, amount: 10_000 }, '2024-01': { count: 1, amount: 10_000 },
    } });
    expect((await searchExpensePage('지난 기록', { sourceWindow: 'prepared-window' })).items.map(item => item.id)).toEqual(['older']);
    expect(mockedGetDocs).toHaveBeenCalledTimes(1);
    closeExpenseSearchWindow('prepared-window');
  });

  test('closing a prepared window rejects its pending result and reopening reads a new source', async () => {
    let resolveSource!: (snapshot: Awaited<ReturnType<typeof getDocsFromServer>>) => void;
    let sourceStarted!: () => void;
    const started = new Promise<void>(resolve => { sourceStarted = resolve; });
    mockedGetDocs.mockImplementationOnce(() => { sourceStarted(); return new Promise(resolve => { resolveSource = resolve; }); });
    const preparation = prepareExpenseSearchWindow('closing-window');
    const pending = searchExpensePage('merchant', { sourceWindow: 'closing-window' });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'SOURCE_WINDOW_CHANGED' });
    await started;
    closeExpenseSearchWindow('closing-window');
    resolveSource({ docs: [ledgerDocument('old')] } as Awaited<ReturnType<typeof getDocsFromServer>>);
    await preparation;
    await rejected;
    mockedGetDocs.mockResolvedValueOnce({ docs: [ledgerDocument('new')] } as Awaited<ReturnType<typeof getDocsFromServer>>);
    await prepareExpenseSearchWindow('reopened-window');
    expect((await searchExpensePage('merchant', { sourceWindow: 'reopened-window' })).items.map(item => item.id)).toEqual(['new']);
    expect(mockedGetDocs).toHaveBeenCalledTimes(2);
    closeExpenseSearchWindow('reopened-window');
  });

  test('a failed preparation is reported without a hidden retry and a later query can read again', async () => {
    mockedGetDocs.mockRejectedValueOnce(new Error('private provider detail'));
    await expect(prepareExpenseSearchWindow('failed-preparation')).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
    await expect(searchExpensePage('merchant', { sourceWindow: 'failed-preparation' })).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
    expect(mockedGetDocs).toHaveBeenCalledTimes(1);
    mockedGetDocs.mockResolvedValueOnce({ docs: [ledgerDocument('fresh')] } as Awaited<ReturnType<typeof getDocsFromServer>>);
    expect((await searchExpensePage('merchant', { sourceWindow: 'failed-preparation' })).items.map(item => item.id)).toEqual(['fresh']);
    expect(mockedGetDocs).toHaveBeenCalledTimes(2);
    closeExpenseSearchWindow('failed-preparation');
  });

  test('searches every month and keeps newest order while excluding dates outside the previous source range', async () => {
    mockedGetDocs.mockResolvedValueOnce({ docs: [
      ledgerDocument('previous-month', { date: '2026-08-15' }),
      ledgerDocument('recent-a', { date: '2026-09-09', time: '10:00' }),
      ledgerDocument('recent-b', { date: '2026-09-09', time: '11:00' }),
      ledgerDocument('recent-z', { date: '2026-09-09', time: '11:00' }),
      ledgerDocument('missing-date', { date: undefined, cardType: 42 }),
      ledgerDocument('null-date', { date: null }),
      ledgerDocument('numeric-date', { date: 20260909 }),
      ledgerDocument('before-range', { date: '0000-12-31' }),
      ledgerDocument('after-range', { date: '9999-12-32' }),
    ] } as Awaited<ReturnType<typeof getDocsFromServer>>);

    const page = await searchExpensePage('merchant');

    expect(page.items.map(item => item.id)).toEqual(['recent-z', 'recent-b', 'recent-a', 'previous-month']);
    expect(page.summary).toEqual({
      count: 4,
      amount: 40_000,
      months: { '2026-09': { count: 3, amount: 30_000 }, '2026-08': { count: 1, amount: 10_000 } },
    });
  });

  test.each([
    { options: { startDate: '2026-09-01' }, conditions: [['date', '>=', '2026-09-01']], expected: ['after', 'end', 'start'] },
    { options: { endDate: '2026-09-30' }, conditions: [['date', '<=', '2026-09-30']], expected: ['end', 'start', 'before'] },
    { options: { startDate: '2026-09-01', endDate: '2026-09-30' }, conditions: [['date', '>=', '2026-09-01'], ['date', '<=', '2026-09-30']], expected: ['end', 'start'] },
  ])('applies only explicitly requested date constraints: $options', async ({ options, conditions, expected }) => {
    mockedGetDocs.mockResolvedValueOnce({ docs: [
      ledgerDocument('before', { date: '2026-08-31' }),
      ledgerDocument('start', { date: '2026-09-01' }),
      ledgerDocument('end', { date: '2026-09-30' }),
      ledgerDocument('after', { date: '2026-10-01' }),
    ] } as Awaited<ReturnType<typeof getDocsFromServer>>);

    const page = await searchExpensePage('merchant', options);

    expect((where as jest.Mock).mock.calls).toEqual([['householdId', '==', 'house-1'], ...conditions]);
    expect(orderBy).not.toHaveBeenCalled();
    expect(documentId).not.toHaveBeenCalled();
    expect(page.items.map(item => item.id)).toEqual(expected);
  });

  test('rejects an inverted requested period before reading the source', async () => {
    await expect(searchExpensePage('merchant', { startDate: '2026-10-01', endDate: '2026-09-30' }))
      .rejects.toMatchObject({ code: 'INVALID_PERIOD' });
    expect(mockedGetDocs).not.toHaveBeenCalled();
  });

  test('returns complete totals below the production Listen query limit', async () => {
    mockedGetDocs.mockResolvedValueOnce({ docs: Array.from({ length: 9_999 }, (_, index) => ledgerDocument(`row-${index}`)) } as Awaited<ReturnType<typeof getDocsFromServer>>);

    const page = await searchExpensePage('merchant');

    expect(limit).toHaveBeenCalledWith(10_000);
    expect(page.items).toHaveLength(50);
    expect(page.summary.count).toBe(9_999);
    expect(page.summary.amount).toBe(99_990_000);
  });

  test('fails at the production Listen limit instead of publishing potentially partial totals', async () => {
    mockedGetDocs.mockResolvedValueOnce({ docs: Array.from({ length: 10_000 }, (_, index) => ledgerDocument(`row-${index}`)) } as Awaited<ReturnType<typeof getDocsFromServer>>);
    await expect(searchExpensePage('merchant')).rejects.toMatchObject({
      code: 'SOURCE_LIMIT_EXCEEDED',
      message: '검색 대상이 조회 한도에 도달해 전체 결과를 확인할 수 없습니다.',
    });
  });

  test('read failures expose a simple message without provider codes or private details', async () => {
    mockedGetDocs.mockRejectedValueOnce(Object.assign(
      new Error('private provider message containing a request token and document contents'),
      { code: 'invalid-argument' }
    ));

    await expect(searchExpensePage('merchant')).rejects.toMatchObject({
      code: 'SOURCE_UNAVAILABLE',
      message: '검색 결과를 불러오지 못했습니다.',
    });
  });

  test('document decoding failures do not expose the error type or original message', async () => {
    mockedGetDocs.mockResolvedValueOnce({
      docs: [{
        id: 'invalid-row',
        data: () => { throw new TypeError('private document contents'); },
      }],
    } as unknown as Awaited<ReturnType<typeof getDocsFromServer>>);

    await expect(searchExpensePage('merchant')).rejects.toMatchObject({
      code: 'SOURCE_UNAVAILABLE',
      message: '검색 결과를 불러오지 못했습니다.',
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
