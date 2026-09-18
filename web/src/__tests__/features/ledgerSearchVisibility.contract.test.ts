import { searchExpenses, subscribeToDateRangeExpenses, prepareExpenseSearchWindow, closeExpenseSearchWindow, createExpenseSearchMatcher, expenseMatchesSearch } from '@/lib/expenseService';
import type { Expense } from '@/types/expense';
import { onSnapshot } from '@/platform/read-model/firestoreReadModel';
import { getDocsFromServer, limit, where, orderBy, documentId, startAfter } from '@/platform/read-model/firestoreServerReadModel';
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
  limit: jest.fn(), orderBy: jest.fn(), documentId: jest.fn(() => '__name__'), startAfter: jest.fn(),
  getDocsFromServer: jest.fn(), db: {},
}));

const mockedGetDocs = getDocsFromServer as jest.MockedFunction<typeof getDocsFromServer>;
type SearchSnapshot = Awaited<ReturnType<typeof getDocsFromServer>>;

function ledgerDocument(
  id: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    id,
    data: () => ({
      householdId: 'house-1',
      transactionType: 'expense',
      accountingDate: '2026-08-11',
      localTime: '12:00',
      merchant: 'matched merchant',
      amountInWon: 10_000,
      categoryId: 'etc',
      cardType: 'captured',
      cardDisplay: 'Samsung(3628)',
      aggregateVersion: 1,
      lifecycleState: 'active',
      ...overrides,
    }),
  };
}

function ledgerPage(offset: number, count: number): SearchSnapshot {
  return { docs: Array.from({ length: count }, (_, index) => ledgerDocument(`row-${String(offset + index).padStart(5, '0')}`)) } as SearchSnapshot;
}

describe('ledger search visibility contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetDocs.mockReset();
    (requireClientSessionScope as jest.Mock).mockReset();
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
    { keyword: '부산', fields: { tags: ['2026부산여행'] }, expected: true },
    { keyword: '#2026부산여행', fields: { tags: ['2026부산여행'] }, expected: true },
    { keyword: '#부산', fields: { tags: ['2026부산여행'], memo: '#부산' }, expected: false },
    { keyword: '#', fields: { tags: ['2026부산여행'] }, expected: false },
    { keyword: '# summer trip ', fields: { tags: ['Summer Trip'] }, expected: true },
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

  test('search returns every matching row and reuses its complete source across keystrokes', async () => {
    mockedGetDocs.mockResolvedValueOnce({ docs: Array.from({ length: 51 }, (_, index) => ledgerDocument(`row-${index}`)) } as Awaited<ReturnType<typeof getDocsFromServer>>);
    const rows = await searchExpenses('merchant', { transactionType: 'expense', sourceWindow: 'window-1' });
    expect(limit).toHaveBeenCalledWith(5_000);
    expect((where as jest.Mock).mock.calls).toEqual([['householdId', '==', 'house-1']]);
    expect(orderBy).toHaveBeenCalledWith(documentId());
    expect(startAfter).not.toHaveBeenCalled();
    expect(rows).toHaveLength(51);
    expect(rows.reduce((amount, row) => amount + row.amount, 0)).toBe(510_000);
    const second = await searchExpenses('matched', { transactionType: 'expense', sourceWindow: 'window-1' });
    expect(second).toEqual(rows);
    expect(mockedGetDocs).toHaveBeenCalledTimes(1);
    closeExpenseSearchWindow('window-1');
  });

  test('태그 검색은 월을 넘어 같은 태그만 합산하고 메모와 비슷한 태그를 제외한다', async () => {
    mockedGetDocs.mockResolvedValueOnce({ docs: [
      ledgerDocument('trip-first', { tags: ['2026부산여행'], accountingDate: '2026-08-31', amountInWon: 30000 }),
      ledgerDocument('trip-second', { tags: ['2026부산여행'], accountingDate: '2026-09-01', amountInWon: 20000 }),
      ledgerDocument('similar-tag', { tags: ['2026부산여행준비'] }),
      ledgerDocument('memo-only', { memo: '2026부산여행' }),
    ] } as SearchSnapshot);
    const rows = await searchExpenses('#2026부산여행', { sourceWindow: 'tag-search' });
    expect(rows.map(row => row.id)).toEqual(['trip-second', 'trip-first']);
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(50000);
    expect((await searchExpenses('2026부산여행', { sourceWindow: 'tag-search' }))).toHaveLength(4);
    closeExpenseSearchWindow('tag-search');
  });

  test('opening and typing share the same in-flight full source, including memo, card evidence and every month', async () => {
    let resolveSource!: (snapshot: Awaited<ReturnType<typeof getDocsFromServer>>) => void;
    let sourceStarted!: () => void;
    const started = new Promise<void>(resolve => { sourceStarted = resolve; });
    mockedGetDocs.mockImplementationOnce(() => { sourceStarted(); return new Promise(resolve => { resolveSource = resolve; }); });
    const preparation = prepareExpenseSearchWindow('prepared-window');
    const search = searchExpenses('삼성(3***)', { transactionType: 'expense', sourceWindow: 'prepared-window' });
    await started;
    expect(mockedGetDocs).toHaveBeenCalledTimes(1);
    resolveSource({ docs: [
      ledgerDocument('older', { accountingDate: '2024-01-01', memo: '지난 기록', cardEvidence: '삼성(3628)' }),
      ledgerDocument('latest', { accountingDate: '2026-09-17', cardEvidence: '삼성(3999)' }),
      ledgerDocument('other-card', { cardEvidence: '국민(3999)' }),
      ledgerDocument('other-type', { transactionType: 'income', cardEvidence: '삼성(3999)' }),
      ledgerDocument('deleted', { lifecycleState: 'deleted', cardEvidence: '삼성(3999)' }),
    ] } as Awaited<ReturnType<typeof getDocsFromServer>>);
    await preparation;
    const rows = await search;
    expect(rows.map(item => item.id)).toEqual(['latest', 'older']);
    expect((await searchExpenses('지난 기록', { sourceWindow: 'prepared-window' })).map(item => item.id)).toEqual(['older']);
    expect(mockedGetDocs).toHaveBeenCalledTimes(1);
    closeExpenseSearchWindow('prepared-window');
  });

  test('closing a prepared window rejects its pending source and stops additional page reads', async () => {
    let resolveSource!: (snapshot: Awaited<ReturnType<typeof getDocsFromServer>>) => void;
    let sourceStarted!: () => void;
    const started = new Promise<void>(resolve => { sourceStarted = resolve; });
    mockedGetDocs.mockImplementationOnce(() => { sourceStarted(); return new Promise(resolve => { resolveSource = resolve; }); });
    const preparation = prepareExpenseSearchWindow('closing-window');
    const preparationRejected = expect(preparation).rejects.toMatchObject({ code: 'SOURCE_WINDOW_CHANGED' });
    const pending = searchExpenses('merchant', { sourceWindow: 'closing-window' });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'SOURCE_WINDOW_CHANGED' });
    await started;
    closeExpenseSearchWindow('closing-window');
    resolveSource(ledgerPage(0, 5_000));
    await preparationRejected;
    await rejected;
    expect(mockedGetDocs).toHaveBeenCalledTimes(1);
    mockedGetDocs.mockResolvedValueOnce({ docs: [ledgerDocument('new')] } as Awaited<ReturnType<typeof getDocsFromServer>>);
    await prepareExpenseSearchWindow('reopened-window');
    expect((await searchExpenses('merchant', { sourceWindow: 'reopened-window' })).map(item => item.id)).toEqual(['new']);
    expect(mockedGetDocs).toHaveBeenCalledTimes(2);
    closeExpenseSearchWindow('reopened-window');
  });

  test('a failed preparation is reported without a hidden retry and a later query can read again', async () => {
    mockedGetDocs.mockRejectedValueOnce(new Error('private provider detail'));
    await expect(prepareExpenseSearchWindow('failed-preparation')).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
    await expect(searchExpenses('merchant', { sourceWindow: 'failed-preparation' })).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
    expect(mockedGetDocs).toHaveBeenCalledTimes(1);
    mockedGetDocs.mockResolvedValueOnce({ docs: [ledgerDocument('fresh')] } as Awaited<ReturnType<typeof getDocsFromServer>>);
    expect((await searchExpenses('merchant', { sourceWindow: 'failed-preparation' })).map(item => item.id)).toEqual(['fresh']);
    expect(mockedGetDocs).toHaveBeenCalledTimes(2);
    closeExpenseSearchWindow('failed-preparation');
  });

  test('searches every month and keeps newest order while excluding dates outside the previous source range', async () => {
    mockedGetDocs.mockResolvedValueOnce({ docs: [
      ledgerDocument('previous-month', { accountingDate: '2026-08-15' }),
      ledgerDocument('recent-a', { accountingDate: '2026-09-09', localTime: '10:00' }),
      ledgerDocument('recent-b', { accountingDate: '2026-09-09', localTime: '11:00' }),
      ledgerDocument('recent-z', { accountingDate: '2026-09-09', localTime: '11:00' }),
      ledgerDocument('missing-date', { accountingDate: undefined, cardType: 42 }),
      ledgerDocument('null-date', { accountingDate: null }),
      ledgerDocument('numeric-date', { accountingDate: 20260909 }),
      ledgerDocument('before-range', { accountingDate: '0000-12-31' }),
      ledgerDocument('after-range', { accountingDate: '9999-12-32' }),
    ] } as Awaited<ReturnType<typeof getDocsFromServer>>);

    const rows = await searchExpenses('merchant');

    expect(rows.map(item => item.id)).toEqual(['recent-z', 'recent-b', 'recent-a', 'previous-month']);
    expect((where as jest.Mock).mock.calls).toEqual([['householdId', '==', 'house-1']]);
  });

  test('empty input does not start a source read', async () => {
    await expect(searchExpenses(' \t ')).resolves.toEqual([]);
    expect(mockedGetDocs).not.toHaveBeenCalled();
  });

  test.each([10_000, 10_001])('returns all %i documents through bounded server pages without a history limit', async (count) => {
    const first = ledgerPage(0, 5_000);
    const second = ledgerPage(5_000, 5_000);
    mockedGetDocs.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
      .mockResolvedValueOnce(ledgerPage(10_000, count - 10_000));
    const windowId = `large-window-${count}`;

    const rows = await searchExpenses('merchant', { sourceWindow: windowId });

    expect(mockedGetDocs).toHaveBeenCalledTimes(3);
    expect((limit as jest.Mock).mock.calls).toEqual([[5_000], [5_000], [5_000]]);
    expect((startAfter as jest.Mock).mock.calls).toEqual([[first.docs[4_999]], [second.docs[4_999]]]);
    expect(rows).toHaveLength(count);
    expect(new Set(rows.map(row => row.id)).size).toBe(count);
    expect(rows.reduce((amount, row) => amount + row.amount, 0)).toBe(count * 10_000);
    expect((await searchExpenses('matched', { sourceWindow: windowId }))).toHaveLength(count);
    expect(mockedGetDocs).toHaveBeenCalledTimes(3);
    closeExpenseSearchWindow(windowId);
  });

  test('keeps earlier pages private while a later page is pending or fails', async () => {
    let rejectPage!: (error: unknown) => void;
    let pageStarted!: () => void;
    const started = new Promise<void>(resolve => { pageStarted = resolve; });
    mockedGetDocs.mockResolvedValueOnce(ledgerPage(0, 5_000)).mockImplementationOnce(() => {
      pageStarted();
      return new Promise((_resolve, reject) => { rejectPage = reject; });
    });
    const published = jest.fn();
    const search = searchExpenses('merchant', { sourceWindow: 'partial-failure' }).then(rows => {
      published(rows);
      return rows;
    });
    const rejected = expect(search).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
    await started;
    expect(published).not.toHaveBeenCalled();
    rejectPage(new Error('private second-page failure'));
    await rejected;
    expect(published).not.toHaveBeenCalled();
    expect(mockedGetDocs).toHaveBeenCalledTimes(2);
    mockedGetDocs.mockResolvedValueOnce({ docs: [ledgerDocument('fresh')] } as SearchSnapshot);
    await expect(searchExpenses('merchant', { sourceWindow: 'partial-failure' }))
      .resolves.toEqual([expect.objectContaining({ id: 'fresh' })]);
    closeExpenseSearchWindow('partial-failure');
  });

  test('rejects a repeated transport cursor instead of looping or publishing duplicates', async () => {
    const repeated = ledgerPage(0, 5_000);
    mockedGetDocs.mockResolvedValue(repeated);
    await expect(searchExpenses('merchant')).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
    expect(mockedGetDocs).toHaveBeenCalledTimes(2);
  });

  test('an old pending source cannot invalidate a reopened window with the same ID', async () => {
    let resolveOld!: (snapshot: SearchSnapshot) => void;
    let oldStarted!: () => void;
    const started = new Promise<void>(resolve => { oldStarted = resolve; });
    mockedGetDocs.mockImplementationOnce(() => {
      oldStarted();
      return new Promise(resolve => { resolveOld = resolve; });
    });
    const old = searchExpenses('merchant', { sourceWindow: 'same-window' });
    const oldRejected = expect(old).rejects.toMatchObject({ code: 'SOURCE_WINDOW_CHANGED' });
    await started;
    closeExpenseSearchWindow('same-window');
    mockedGetDocs.mockResolvedValueOnce({ docs: [ledgerDocument('current')] } as SearchSnapshot);
    const current = await searchExpenses('merchant', { sourceWindow: 'same-window' });
    resolveOld(ledgerPage(0, 5_000));
    await oldRejected;
    await expect(searchExpenses('matched', { sourceWindow: 'same-window' })).resolves.toEqual(current);
    expect(mockedGetDocs).toHaveBeenCalledTimes(2);
    closeExpenseSearchWindow('same-window');
  });

  test('read failures expose a simple message without provider codes or private details', async () => {
    mockedGetDocs.mockRejectedValueOnce(Object.assign(
      new Error('private provider message containing a request token and document contents'),
      { code: 'invalid-argument' }
    ));

    await expect(searchExpenses('merchant')).rejects.toMatchObject({
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

    await expect(searchExpenses('merchant')).rejects.toMatchObject({
      code: 'SOURCE_UNAVAILABLE',
      message: '검색 결과를 불러오지 못했습니다.',
    });
  });

  test.each([
    { householdId: 'house-2' },
    { principalUid: 'uid-2' },
    { sessionGeneration: 2 },
    { memberId: 'member-2' },
    { accessMode: 'administrator-readonly' },
  ])('drops old source pages and stops reading after a session identity change: %o', async (changed) => {
    mockedGetDocs.mockImplementationOnce(async () => {
      (requireClientSessionScope as jest.Mock).mockReturnValue({ householdId: 'house-1', memberId: 'member-1', principalUid: 'uid', sessionGeneration: 1, ...changed });
      return ledgerPage(0, 5_000);
    });
    await expect(searchExpenses('merchant')).rejects.toMatchObject({ code: 'SOURCE_WINDOW_CHANGED' });
    expect(mockedGetDocs).toHaveBeenCalledTimes(1);
  });

  test('stops additional reads when the authenticated session is cleared', async () => {
    mockedGetDocs.mockImplementationOnce(async () => {
      (requireClientSessionScope as jest.Mock).mockImplementation(() => { throw new Error('no session'); });
      return ledgerPage(0, 5_000);
    });
    await expect(searchExpenses('merchant')).rejects.toMatchObject({ code: 'SOURCE_WINDOW_CHANGED' });
    expect(mockedGetDocs).toHaveBeenCalledTimes(1);
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
