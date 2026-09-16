import { readAssetStatisticsHistory } from '@/platform/reporting/assetStatisticsReadModel';
import { invalidateAssetStatisticsCache } from '@/platform/reporting/assetStatisticsQueryCache';
import { setClientSessionScope, clearClientSessionScope, type ClientSessionScope } from '@/composition/clientSessionScope';
import { resetLoadedClientSessionState } from '@/composition/clientSessionResetRegistry';
import { getDocsFromServer } from '@/platform/read-model/firestoreReadModel';

jest.mock('@/platform/read-model/firestoreReadModel', () => ({
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
  const history = await readAssetStatisticsHistory(undefined, '2026-09-30');
  expect(read).toHaveBeenCalledTimes(1);
  expect((read.mock.calls[0][0] as any).source).toBe('households/home/assetSnapshots');
  expect(history.filter(row => row.assetId === 'TOTAL')).toHaveLength(441);
  expect(history.filter(row => row.assetId === 'TOTAL').at(-1)).toMatchObject({ balance: 440, changeAmount: 1 });
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
  const pending = readAssetStatisticsHistory(undefined, '2026-09-30').then(result => { settled = true; return result; });
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
  await expect(readAssetStatisticsHistory(undefined, '2026-09-30')).rejects.toThrow('STATISTICS_PAGE_LIMIT_EXCEEDED');
  expect(offset).toBe(50_000);
  expect(read).toHaveBeenCalledTimes(10);
});

it('preserves the zero baseline and stable dimensions before a selected range', async () => {
  read.mockResolvedValueOnce({ docs: [canonical('2019-01-01', 0)] } as any)
    .mockResolvedValueOnce({ docs: [canonical('2026-09-07', 50)] } as any);
  const history = await readAssetStatisticsHistory('2026-09-01', '2026-09-30');
  expect(history.filter(row => row.assetId === 'TOTAL').map(row => [row.balance, row.changeAmount])).toEqual([[0, 0], [50, 50]]);
  expect(history.find(row => row.assetId === 'OWNER_REF_archived')).toMatchObject({ balance: 0, ownerKey: 'archived' });
});

it('deduplicates in-flight reads and reuses only completed history for 30 seconds; refresh and epoch force new reads', async () => {
  const clock = jest.spyOn(Date, 'now').mockReturnValue(1000);
  read.mockResolvedValue({ docs: [] } as any);
  await Promise.all([readAssetStatisticsHistory(undefined, '2026-09-30'), readAssetStatisticsHistory(undefined, '2026-09-30')]);
  expect(read).toHaveBeenCalledTimes(1);
  await readAssetStatisticsHistory(undefined, '2026-09-30');
  expect(read).toHaveBeenCalledTimes(1);
  await readAssetStatisticsHistory(undefined, '2026-09-30', { forceRefresh: true });
  expect(read).toHaveBeenCalledTimes(2);
  await readAssetStatisticsHistory(undefined, '2026-09-30', { cacheEpoch: 1 });
  expect(read).toHaveBeenCalledTimes(3);
  clock.mockReturnValue(31_000);
  await readAssetStatisticsHistory(undefined, '2026-09-30', { cacheEpoch: 1 });
  expect(read).toHaveBeenCalledTimes(4);
});

it.each([
  { principalUid: 'other' }, { householdId: 'other' }, { memberId: 'other' },
  { sessionGeneration: 2 }, { accessMode: 'administrator-readonly' as const },
])('does not reuse another actor scope: %j', async changed => {
  read.mockResolvedValue({ docs: [] } as any);
  await readAssetStatisticsHistory(undefined, '2026-09-30');
  setClientSessionScope({ ...scope, ...changed });
  await readAssetStatisticsHistory(undefined, '2026-09-30');
  expect(read).toHaveBeenCalledTimes(2);
});

it.each([resetLoadedClientSessionState, invalidateAssetStatisticsCache])('discards a pending response after reset/invalidation and cannot repopulate the cache', async reset => {
  const pending = deferred<any>();
  read.mockReturnValueOnce(pending.promise).mockResolvedValue({ docs: [] } as any);
  const old = readAssetStatisticsHistory(undefined, '2026-09-30');
  const rejected = expect(old).rejects.toThrow('STATISTICS_SESSION_CHANGED');
  await Promise.resolve();
  reset();
  pending.resolve({ docs: [canonical('2020-01-01', 1)] });
  await rejected;
  await readAssetStatisticsHistory(undefined, '2026-09-30');
  expect(read).toHaveBeenCalledTimes(2);
});

it.each(['invalidation', 'remote epoch', 'forced refresh'] as const)('stops the previous full page before requesting another page after %s', async change => {
  const pending = deferred<any>();
  read.mockReturnValueOnce(pending.promise).mockResolvedValue({ docs: [] } as any);
  const old = readAssetStatisticsHistory(undefined, '2026-09-30');
  const rejected = expect(old).rejects.toThrow('STATISTICS_SESSION_CHANGED');
  await Promise.resolve();
  expect(read).toHaveBeenCalledTimes(1);
  if (change === 'invalidation') invalidateAssetStatisticsCache();
  const options = change === 'remote epoch' ? { cacheEpoch: 1 }
    : change === 'forced refresh' ? { forceRefresh: true } : undefined;
  await readAssetStatisticsHistory(undefined, '2026-09-30', options);
  pending.resolve({ docs: Array.from({ length: 5_000 }, (_, index) => canonical(new Date(Date.UTC(2000, 0, index + 1)).toISOString().slice(0, 10), index)) });
  await rejected;
  expect(read).toHaveBeenCalledTimes(2);
  expect(read.mock.calls.every(([request]) => !(request as any).constraints.some((value: any) => value.kind === 'cursor'))).toBe(true);
});

it('never caches a failed source as an empty success and allows immediate retry', async () => {
  read.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ docs: [] } as any);
  await expect(readAssetStatisticsHistory(undefined, '2026-09-30')).rejects.toThrow('offline');
  await expect(readAssetStatisticsHistory(undefined, '2026-09-30')).resolves.toEqual([]);
  expect(read).toHaveBeenCalledTimes(2);
});

it('rejects repeated pages rather than showing a truncated total', async () => {
  const rows = Array.from({ length: 5_000 }, (_, index) => canonical(new Date(Date.UTC(2000, 0, index + 1)).toISOString().slice(0, 10), index));
  read.mockImplementation((request: any) => Promise.resolve({ docs: rows }) as any);
  await expect(readAssetStatisticsHistory(undefined, '2026-09-30')).rejects.toThrow('STATISTICS_CURSOR_REPEATED');
});
