import { peekAssetStatisticsHistory, readAssetStatisticsHistory } from '@/platform/reporting/assetStatisticsReadModel';
import { invalidateAssetStatisticsCache } from '@/platform/reporting/assetStatisticsQueryCache';
import { setClientSessionScope, clearClientSessionScope, type ClientSessionScope } from '@/composition/clientSessionScope';
import { resetLoadedClientSessionState } from '@/composition/clientSessionResetRegistry';
import { getDocsFromServer } from '@/platform/read-model/firestoreServerReadModel';

jest.mock('@/platform/read-model/firestoreServerReadModel', () => ({
  db: {}, collection: jest.fn((_db, ...path) => path.join('/')),
  query: jest.fn((source, ...constraints) => ({ source, constraints })),
  where: jest.fn((...args) => ({ kind: 'where', args })),
  orderBy: jest.fn((...args) => ({ kind: 'orderBy', args })), documentId: jest.fn(() => '__name__'),
  startAfter: jest.fn(cursor => ({ kind: 'cursor', cursor })),
  limit: jest.fn(size => ({ kind: 'limit', size })), getDocsFromServer: jest.fn(),
}));
const read = jest.mocked(getDocsFromServer);
const scope: ClientSessionScope = { householdId: 'home', principalUid: 'uid', memberId: 'member', sessionGeneration: 1 };
const canonical = (date: string, total: number) => ({ id: date, data: () => ({
  localDate: date, total, financial: total, byType: { stock: total }, byOwnerRefKey: { archived: total },
}) });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; }
beforeEach(() => { jest.clearAllMocks(); read.mockReset(); resetLoadedClientSessionState(); setClientSessionScope(scope); });
afterEach(() => { jest.restoreAllMocks(); clearClientSessionScope(); });

it('reads migrated historical dates from one canonical source without querying the old collection', async () => {
  const rows = Array.from({ length: 441 }, (_, index) => canonical(new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10), index));
  read.mockResolvedValue({ docs: rows } as any);
  const history = await readAssetStatisticsHistory('2026-09-30');
  expect(read).toHaveBeenCalledTimes(1);
  expect((read.mock.calls[0][0] as any).source).toBe('households/home/assetSnapshots');
  expect(history.filter(row => row.assetId === 'TOTAL')).toHaveLength(441);
  expect(history.filter(row => row.assetId === 'TOTAL').at(-1)).toMatchObject({ balance: 440, changeAmount: 1 });
});

it('decodes each SDK document once while preserving every ordered dimension, change and caller isolation', async () => {
  const rows = ['2026-09-01', '2026-09-02', '2026-09-03'].map((localDate, index) => ({
    id: localDate,
    data: jest.fn(() => ({ localDate, total: [100, 0, -20][index], financial: [70, 0, 10][index],
      byType: { stock: [70, 0, 10][index], loan: [30, 0, -30][index] },
      byOwnerRefKey: { 'profile:archived': [100, 0, -20][index] },
      ownerDisplayNames: { 'profile:archived': '이전 명의자' },
    })),
  }));
  read.mockResolvedValueOnce({ docs: rows } as any);
  const history = await readAssetStatisticsHistory('2026-09-30');
  expect(rows.every(row => row.data.mock.calls.length === 1)).toBe(true);
  expect(history).toHaveLength(15);
  expect(history.map(row => `${row.date}:${row.assetId}`)).toEqual(
    rows.flatMap(row => ['FINANCIAL', 'OWNER_REF_profile:archived', 'TOTAL', 'TYPE_loan', 'TYPE_stock']
      .map(assetId => `${row.id}:${assetId}`)),
  );
  expect(history.filter(row => row.assetId === 'TOTAL').map(row => [row.balance, row.changeAmount]))
    .toEqual([[100, 0], [0, -100], [-20, -20]]);
  expect(history.find(row => row.assetId === 'OWNER_REF_profile:archived')).toMatchObject({
    ownerKey: 'profile:archived', ownerDisplayName: '이전 명의자',
  });
  history[0].balance = 999;
  expect(peekAssetStatisticsHistory('2026-09-30')?.[0].balance).toBe(70);
  expect(read).toHaveBeenCalledTimes(1);
});

it('reads all 5,001 daily snapshots before publishing the complete history', async () => {
  const rows = Array.from({ length: 5_001 }, (_, index) => {
    const date = new Date(Date.UTC(2010, 0, index + 1)).toISOString().slice(0, 10);
    return canonical(date, index);
  });
  const lastPage = deferred<{ docs: typeof rows }>();
  const lastPageStarted = deferred<void>();
  read.mockImplementation((request: any) => {
    expect(request.constraints.find((value: any) => value.kind === 'limit').size).toBe(5_000);
    const cursor = request.constraints.find((value: any) => value.kind === 'cursor')?.cursor;
    if (!cursor) return Promise.resolve({ docs: rows.slice(0, 5_000) }) as any;
    expect(cursor.id).toBe(rows[4_999].id);
    lastPageStarted.resolve();
    return lastPage.promise as any;
  });
  let settled = false;
  const pending = readAssetStatisticsHistory('2026-09-30').then(result => { settled = true; return result; });
  await lastPageStarted.promise;
  expect(settled).toBe(false);
  lastPage.resolve({ docs: rows.slice(5_000) });
  const history = await pending;
  expect(read).toHaveBeenCalledTimes(2);
  expect(history.filter(row => row.assetId === 'TOTAL')).toHaveLength(5_001);
  expect(history.filter(row => row.assetId === 'TOTAL').at(-1)).toMatchObject({ balance: 5_000, changeAmount: 1 });
});

it('keeps the 50,000-document bound without publishing partial history', async () => {
  let offset = 0;
  read.mockImplementation((request: any) => {
    const docs = Array.from({ length: 5_000 }, (_, index) => {
      const number = offset + index;
      const date = new Date(Date.UTC(1800, 0, number + 1)).toISOString().slice(0, 10);
      return canonical(date, number);
    });
    offset += docs.length;
    return Promise.resolve({ docs }) as any;
  });
  await expect(readAssetStatisticsHistory('2026-09-30')).rejects.toThrow('STATISTICS_PAGE_LIMIT_EXCEEDED');
  expect(offset).toBe(50_000);
  expect(read).toHaveBeenCalledTimes(10);
});

it('preserves the zero baseline and stable dimensions before a selected range', async () => {
  read.mockResolvedValueOnce({ docs: [canonical('2019-01-01', 0), canonical('2026-09-07', 50)] } as any);
  const history = await readAssetStatisticsHistory('2026-09-30');
  expect(history.filter(row => row.assetId === 'TOTAL').map(row => [row.balance, row.changeAmount])).toEqual([[0, 0], [50, 50]]);
  expect(history.find(row => row.assetId === 'OWNER_REF_archived')).toMatchObject({ balance: 0, ownerKey: 'archived' });
});

it('shares pending reads and revalidates completed history on every request', async () => {
  read.mockResolvedValue({ docs: [] } as any);
  await Promise.all([readAssetStatisticsHistory('2026-09-30'), readAssetStatisticsHistory('2026-09-30')]);
  expect(read).toHaveBeenCalledTimes(1);
  await readAssetStatisticsHistory('2026-09-30');
  expect(read).toHaveBeenCalledTimes(2);
});

it.each([
  { principalUid: 'other' }, { householdId: 'other' }, { memberId: 'other' },
  { sessionGeneration: 2 }, { accessMode: 'administrator-readonly' as const },
])('does not reuse another actor scope: %j', async changed => {
  read.mockResolvedValue({ docs: [] } as any);
  await readAssetStatisticsHistory('2026-09-30');
  setClientSessionScope({ ...scope, ...changed });
  await readAssetStatisticsHistory('2026-09-30');
  expect(read).toHaveBeenCalledTimes(2);
});

it.each([resetLoadedClientSessionState, invalidateAssetStatisticsCache])('discards a pending response after reset/invalidation and cannot repopulate the cache', async reset => {
  const pending = deferred<any>();
  read.mockReturnValueOnce(pending.promise).mockResolvedValue({ docs: [] } as any);
  const old = readAssetStatisticsHistory('2026-09-30');
  const rejected = expect(old).rejects.toThrow('STATISTICS_SESSION_CHANGED');
  await Promise.resolve();
  reset();
  pending.resolve({ docs: [canonical('2020-01-01', 1)] });
  await rejected;
  await readAssetStatisticsHistory('2026-09-30');
  expect(read).toHaveBeenCalledTimes(2);
});

it.each(['invalidation', 'remote epoch', 'end date'] as const)('stops the previous full page before requesting another page after %s', async change => {
  const pending = deferred<any>();
  read.mockReturnValueOnce(pending.promise).mockResolvedValue({ docs: [] } as any);
  const old = readAssetStatisticsHistory('2026-09-30');
  const rejected = expect(old).rejects.toThrow('STATISTICS_SESSION_CHANGED');
  await Promise.resolve();
  expect(read).toHaveBeenCalledTimes(1);
  if (change === 'invalidation') invalidateAssetStatisticsCache();
  const options = change === 'remote epoch' ? { cacheEpoch: 1 } : undefined;
  const endDate = change === 'end date' ? '2026-10-01' : '2026-09-30';
  expect(peekAssetStatisticsHistory(endDate, options)).toBeUndefined();
  await readAssetStatisticsHistory(endDate, options);
  pending.resolve({ docs: Array.from({ length: 5_000 }, (_, index) => canonical(new Date(Date.UTC(2000, 0, index + 1)).toISOString().slice(0, 10), index)) });
  await rejected;
  expect(read).toHaveBeenCalledTimes(2);
  expect(read.mock.calls.every(([request]) => !(request as any).constraints.some((value: any) => value.kind === 'cursor'))).toBe(true);
});

it('never caches a failed source as an empty success and allows immediate retry', async () => {
  read.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ docs: [] } as any);
  await expect(readAssetStatisticsHistory('2026-09-30')).rejects.toThrow('offline');
  await expect(readAssetStatisticsHistory('2026-09-30')).resolves.toEqual([]);
  expect(read).toHaveBeenCalledTimes(2);
});

it('retains the complete history during verification and shares the same pending server read', async () => {
  read.mockResolvedValueOnce({ docs: [canonical('2026-09-01', 100)] } as any);
  await readAssetStatisticsHistory('2026-09-30');
  const pending = deferred<any>();
  read.mockReturnValueOnce(pending.promise);
  const first = readAssetStatisticsHistory('2026-09-30');
  const second = readAssetStatisticsHistory('2026-09-30');
  await Promise.resolve();
  expect(read).toHaveBeenCalledTimes(2);
  expect(peekAssetStatisticsHistory('2026-09-30')?.find(row => row.assetId === 'TOTAL')?.balance).toBe(100);
  pending.resolve({ docs: [canonical('2026-09-01', 200)] });
  const [left, right] = await Promise.all([first, second]);
  expect(left).toEqual(right);
  expect(left.find(row => row.assetId === 'TOTAL')?.balance).toBe(200);
  expect(peekAssetStatisticsHistory('2026-09-30')?.find(row => row.assetId === 'TOTAL')?.balance).toBe(200);
});

it('preserves the completed cache after verification failure while keeping the failure visible to its caller', async () => {
  read.mockResolvedValueOnce({ docs: [canonical('2026-09-01', 100)] } as any)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ docs: [canonical('2026-09-01', 200)] } as any);
  await readAssetStatisticsHistory('2026-09-30');
  await expect(readAssetStatisticsHistory('2026-09-30')).rejects.toThrow('offline');
  expect(peekAssetStatisticsHistory('2026-09-30')?.find(row => row.assetId === 'TOTAL')?.balance).toBe(100);
  expect(peekAssetStatisticsHistory('2026-09-30', { cacheEpoch: 1 })).toBeUndefined();
  await readAssetStatisticsHistory('2026-09-30');
  expect(peekAssetStatisticsHistory('2026-09-30')?.find(row => row.assetId === 'TOTAL')?.balance).toBe(200);
  setClientSessionScope({ ...scope, memberId: 'other' });
  expect(peekAssetStatisticsHistory('2026-09-30')).toBeUndefined();
});

it('rejects repeated pages rather than showing a truncated total', async () => {
  const rows = Array.from({ length: 5_000 }, (_, index) => canonical(new Date(Date.UTC(2000, 0, index + 1)).toISOString().slice(0, 10), index));
  read.mockImplementation((request: any) => Promise.resolve({ docs: rows }) as any);
  await expect(readAssetStatisticsHistory('2026-09-30')).rejects.toThrow('STATISTICS_CURSOR_REPEATED');
});

it.each(['reset', 'actor round trip'] as const)('never revives an earlier pending request for the same actor after %s', async change => {
  const pending = deferred<any>();
  read.mockReturnValueOnce(pending.promise).mockResolvedValue({ docs: [] } as any);
  const old = readAssetStatisticsHistory('2026-09-30');
  const rejected = expect(old).rejects.toThrow('STATISTICS_SESSION_CHANGED');
  await Promise.resolve();
  if (change === 'reset') resetLoadedClientSessionState();
  else {
    setClientSessionScope({ ...scope, memberId: 'other' });
    await readAssetStatisticsHistory('2026-09-30');
    setClientSessionScope(scope);
  }
  read.mockResolvedValueOnce({ docs: [canonical('2026-09-30', 200)] } as any);
  await readAssetStatisticsHistory('2026-09-30');
  const callsBeforeOldReply = read.mock.calls.length;
  pending.resolve({ docs: Array.from({ length: 5_000 }, (_, index) => canonical(new Date(Date.UTC(2000, 0, index + 1)).toISOString().slice(0, 10), index)) });
  await rejected;
  expect(read).toHaveBeenCalledTimes(callsBeforeOldReply);
  expect(peekAssetStatisticsHistory('2026-09-30')?.find(row => row.assetId === 'TOTAL')?.balance).toBe(200);
});

it('exposes completed history only for its exact end date and remote epoch', async () => {
  read.mockResolvedValue({ docs: [canonical('2026-09-30', 100)] } as any);
  await readAssetStatisticsHistory('2026-09-30');
  expect(peekAssetStatisticsHistory('2026-09-30')).toBeDefined();
  expect(peekAssetStatisticsHistory('2026-10-01')).toBeUndefined();
  expect(peekAssetStatisticsHistory('2026-09-30', { cacheEpoch: 1 })).toBeUndefined();
  await readAssetStatisticsHistory('2026-10-01', { cacheEpoch: 1 });
  expect(peekAssetStatisticsHistory('2026-09-30')).toBeUndefined();
  expect(peekAssetStatisticsHistory('2026-10-01', { cacheEpoch: 1 })).toBeDefined();
});
