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
const legacy = (index: number) => ({ id: 'legacy-' + index, data: () => ({
  assetId: 'TOTAL', date: new Date(Date.UTC(2019, 0, index % 2500 + 1)).toISOString().slice(0, 10), balance: index,
}) });
const canonical = (date: string, total: number) => ({ id: date, data: () => ({
  localDate: date, total, financial: total, byType: { stock: total }, byOwnerRefKey: { archived: total },
}) });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; }
beforeEach(() => { jest.clearAllMocks(); read.mockReset(); resetLoadedClientSessionState(); setClientSessionScope(scope); });
afterEach(() => { jest.restoreAllMocks(); clearClientSessionScope(); });

it('reads a representative 2,074 legacy rows with one bounded page, in parallel with canonical, and only publishes complete totals', async () => {
  const rows = Array.from({ length: 2074 }, (_, index) => legacy(index));
  const first = deferred<{ docs: typeof rows }>();
  let legacyCalls = 0;
  read.mockImplementation((request: any) => {
    if (request.source !== 'asset_history') return Promise.resolve({ docs: [canonical('2026-09-07', 3000)] }) as any;
    legacyCalls += 1;
    const size = request.constraints.find((value: any) => value.kind === 'limit').size;
    expect(size).toBe(5_000);
    if (legacyCalls === 1) return first.promise as any;
    const cursor = request.constraints.find((value: any) => value.kind === 'cursor').cursor;
    const offset = rows.findIndex(row => row.id === cursor.id) + 1;
    return Promise.resolve({ docs: rows.slice(offset, offset + size) }) as any;
  });
  let settled = false;
  const result = readAssetStatisticsHistory(undefined, '2026-09-30').then(value => { settled = true; return value; });
  await Promise.resolve();
  expect(read).toHaveBeenCalledTimes(2); // Canonical starts while the first legacy page is pending.
  expect(settled).toBe(false);
  first.resolve({ docs: rows });
  const history = await result;
  expect(read).toHaveBeenCalledTimes(2);
  expect(history.filter(row => row.assetId === 'TOTAL')).toHaveLength(2075);
  expect(history.filter(row => row.assetId === 'TOTAL').at(-1)).toMatchObject({ balance: 3000, changeAmount: 927 });
});

it.each(['legacy', 'canonical'] as const)('reads all 5,001 %s records before publishing the complete history', async source => {
  const rows = Array.from({ length: 5_001 }, (_, index) => {
    const date = new Date(Date.UTC(2010, 0, index + 1)).toISOString().slice(0, 10);
    return source === 'canonical' ? canonical(date, index) : {
      id: 'legacy-' + index,
      data: () => ({ assetId: 'TOTAL', date, balance: index }),
    };
  });
  const lastPage = deferred<{ docs: typeof rows }>();
  const lastPageStarted = deferred<void>();
  read.mockImplementation((request: any) => {
    if ((request.source === 'asset_history') !== (source === 'legacy')) return Promise.resolve({ docs: [] }) as any;
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
  expect(read).toHaveBeenCalledTimes(3);
  expect(history.filter(row => row.assetId === 'TOTAL')).toHaveLength(5_001);
  expect(history.filter(row => row.assetId === 'TOTAL').at(-1)).toMatchObject({ balance: 5_000, changeAmount: 1 });
});

it.each(['legacy', 'canonical'] as const)('keeps the 50,000-document %s source bound without publishing partial history', async source => {
  let offset = 0;
  read.mockImplementation((request: any) => {
    if ((request.source === 'asset_history') !== (source === 'legacy')) return Promise.resolve({ docs: [] }) as any;
    const docs = Array.from({ length: 5_000 }, (_, index) => {
      const number = offset + index;
      const date = new Date(Date.UTC(1800, 0, number + 1)).toISOString().slice(0, 10);
      return source === 'canonical' ? canonical(date, number) : {
        id: 'legacy-' + number,
        data: () => ({ assetId: 'TOTAL', date, balance: number }),
      };
    });
    offset += docs.length;
    return Promise.resolve({ docs }) as any;
  });
  await expect(readAssetStatisticsHistory(undefined, '2026-09-30')).rejects.toThrow('STATISTICS_PAGE_LIMIT_EXCEEDED');
  expect(offset).toBe(50_000);
  expect(read).toHaveBeenCalledTimes(11); // Ten pages for this source and one for the independent source.
});

it('preserves the canonical zero baseline, stable dimensions, and legacy fallback before a selected range', async () => {
  read.mockResolvedValueOnce({ docs: [legacy(0)] } as any)
    .mockResolvedValueOnce({ docs: [canonical('2019-01-01', 0)] } as any)
    .mockResolvedValueOnce({ docs: [canonical('2026-09-07', 50)] } as any);
  const history = await readAssetStatisticsHistory('2026-09-01', '2026-09-30');
  expect(history.filter(row => row.assetId === 'TOTAL').map(row => [row.balance, row.changeAmount])).toEqual([[0, 0], [50, 50]]);
  expect(history.find(row => row.assetId === 'OWNER_REF_archived')).toMatchObject({ balance: 0, ownerKey: 'archived' });
});

it('deduplicates in-flight reads and reuses only completed history for 30 seconds; refresh and epoch force new reads', async () => {
  const clock = jest.spyOn(Date, 'now').mockReturnValue(1000);
  read.mockResolvedValue({ docs: [] } as any);
  await Promise.all([readAssetStatisticsHistory(undefined, '2026-09-30'), readAssetStatisticsHistory(undefined, '2026-09-30')]);
  expect(read).toHaveBeenCalledTimes(2);
  await readAssetStatisticsHistory(undefined, '2026-09-30');
  expect(read).toHaveBeenCalledTimes(2);
  await readAssetStatisticsHistory(undefined, '2026-09-30', { forceRefresh: true });
  expect(read).toHaveBeenCalledTimes(4);
  await readAssetStatisticsHistory(undefined, '2026-09-30', { cacheEpoch: 1 });
  expect(read).toHaveBeenCalledTimes(6);
  clock.mockReturnValue(31_000);
  await readAssetStatisticsHistory(undefined, '2026-09-30', { cacheEpoch: 1 });
  expect(read).toHaveBeenCalledTimes(8);
});

it.each([
  { principalUid: 'other' }, { householdId: 'other' }, { memberId: 'other' },
  { sessionGeneration: 2 }, { accessMode: 'administrator-readonly' as const },
])('does not reuse another actor scope: %j', async changed => {
  read.mockResolvedValue({ docs: [] } as any);
  await readAssetStatisticsHistory(undefined, '2026-09-30');
  setClientSessionScope({ ...scope, ...changed });
  await readAssetStatisticsHistory(undefined, '2026-09-30');
  expect(read).toHaveBeenCalledTimes(4);
});

it.each([resetLoadedClientSessionState, invalidateAssetStatisticsCache])('discards a pending response after reset/invalidation and cannot repopulate the cache', async reset => {
  const pending = deferred<any>();
  read.mockReturnValueOnce(pending.promise).mockResolvedValue({ docs: [] } as any);
  const old = readAssetStatisticsHistory(undefined, '2026-09-30');
  const rejected = expect(old).rejects.toThrow('STATISTICS_SESSION_CHANGED');
  await Promise.resolve();
  reset();
  pending.resolve({ docs: [legacy(1)] });
  await rejected;
  await readAssetStatisticsHistory(undefined, '2026-09-30');
  expect(read).toHaveBeenCalledTimes(4);
});

it.each(['invalidation', 'remote epoch', 'forced refresh'] as const)('stops the previous full page before requesting another page after %s', async change => {
  const pending = deferred<any>();
  read.mockReturnValueOnce(pending.promise).mockResolvedValue({ docs: [] } as any);
  const old = readAssetStatisticsHistory(undefined, '2026-09-30');
  const rejected = expect(old).rejects.toThrow('STATISTICS_SESSION_CHANGED');
  await Promise.resolve();
  expect(read).toHaveBeenCalledTimes(2);
  if (change === 'invalidation') invalidateAssetStatisticsCache();
  const options = change === 'remote epoch' ? { cacheEpoch: 1 }
    : change === 'forced refresh' ? { forceRefresh: true } : undefined;
  await readAssetStatisticsHistory(undefined, '2026-09-30', options);
  pending.resolve({ docs: Array.from({ length: 5_000 }, (_, index) => legacy(index)) });
  await rejected;
  expect(read).toHaveBeenCalledTimes(4);
  expect(read.mock.calls.every(([request]) => !(request as any).constraints.some((value: any) => value.kind === 'cursor'))).toBe(true);
});

it('stops the other paginated source after a parallel source fails', async () => {
  const pending = deferred<any>();
  read.mockReturnValueOnce(pending.promise).mockRejectedValueOnce(new Error('canonical unavailable'));
  await expect(readAssetStatisticsHistory(undefined, '2026-09-30')).rejects.toThrow('canonical unavailable');
  pending.resolve({ docs: Array.from({ length: 5_000 }, (_, index) => legacy(index)) });
  await pending.promise;
  await Promise.resolve();
  expect(read).toHaveBeenCalledTimes(2);
});

it('never caches a failed source as an empty success and allows immediate retry', async () => {
  read.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ docs: [] } as any);
  await expect(readAssetStatisticsHistory(undefined, '2026-09-30')).rejects.toThrow('offline');
  await expect(readAssetStatisticsHistory(undefined, '2026-09-30')).resolves.toEqual([]);
  expect(read).toHaveBeenCalledTimes(4);
});

it('rejects repeated pages rather than showing a truncated total', async () => {
  const rows = Array.from({ length: 5_000 }, (_, index) => legacy(index));
  read.mockImplementation((request: any) => Promise.resolve({ docs: request.source === 'asset_history' ? rows : [] }) as any);
  await expect(readAssetStatisticsHistory(undefined, '2026-09-30')).rejects.toThrow('STATISTICS_CURSOR_REPEATED');
});
