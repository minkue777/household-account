import { readExpenseStatistics } from '@/platform/reporting/expenseStatisticsReadModel';
import { readAssetStatisticsHistory } from '@/platform/reporting/assetStatisticsReadModel';
import { getDocsFromServer, where, limit, startAfter } from '@/platform/read-model/firestoreReadModel';
import { resolveExpenseStatisticsPeriod } from '@/features/reporting/statisticsPeriod';

let mockScope = { householdId: 'home', principalUid: 'uid', memberId: 'member', sessionGeneration: 1 };
jest.mock('@/composition/clientSessionScope', () => ({ requireClientSessionScope: () => mockScope, getClientSessionScope: () => mockScope }));
jest.mock('@/platform/read-model/firestoreReadModel', () => ({ db: {}, collection: jest.fn((_db, ...path) => path.join('/')), query: jest.fn((...args) => args), where: jest.fn((...args) => args), orderBy: jest.fn(), documentId: jest.fn(), startAfter: jest.fn(), limit: jest.fn(), getDocsFromServer: jest.fn() }));
const read = getDocsFromServer as jest.Mock;
const doc = (id: string, values: Record<string, unknown>) => ({ id, data: () => values });
const expense = (id: string, extra = {}) => doc(id, { householdId: 'home', date: '2026-09-01', amount: 0, category: 'food', transactionType: 'expense', ...extra });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; }
beforeEach(() => { jest.clearAllMocks(); mockScope = { householdId: 'home', principalUid: 'uid', memberId: 'member', sessionGeneration: 1 }; });

it('reads every bounded expense page before publishing and excludes income/deleted rows using the actual mapper', async () => {
  const lastPage = deferred<{ docs: ReturnType<typeof expense>[] }>();
  const lastPageStarted = deferred<void>();
  read.mockResolvedValueOnce({ docs: Array.from({ length: 5_000 }, (_, i) => expense('a' + i)) })
    .mockImplementationOnce(() => { lastPageStarted.resolve(); return lastPage.promise; });
  let settled = false;
  const pending = readExpenseStatistics('2026-09-01', '2026-09-30').then(result => { settled = true; return result; });
  await lastPageStarted.promise;
  expect(settled).toBe(false);
  lastPage.resolve({ docs: [expense('income', { transactionType: 'income' }), expense('deleted', { lifecycleState: 'deleted' }), expense('last', { amount: 10 })] });
  const result = await pending;
  expect(result).toHaveLength(5_001); expect(result.reduce((sum, row) => sum + row.amount, 0)).toBe(10);
  expect(where).toHaveBeenCalledWith('date', '>=', '2026-09-01'); expect(where).toHaveBeenCalledWith('date', '<=', '2026-09-30');
  expect(limit).toHaveBeenCalledWith(5_000); expect(startAfter).toHaveBeenCalledTimes(1);
});
it('rejects repeated cursor records and previous-session replies instead of publishing partial success', async () => {
  const rows = Array.from({ length: 5_000 }, (_, i) => expense('a' + i));
  read.mockResolvedValue({ docs: rows });
  await expect(readExpenseStatistics('2026-09-01', '2026-09-30')).rejects.toThrow('STATISTICS_CURSOR_REPEATED');
  read.mockImplementationOnce(async () => { mockScope = { ...mockScope, sessionGeneration: 2 }; return { docs: [] }; });
  await expect(readExpenseStatistics('2026-09-01', '2026-09-30')).rejects.toThrow('STATISTICS_SESSION_CHANGED');
});
it('reads a representative 1,729-document year in one bounded request, with every row included', async () => {
  const rows = Array.from({ length: 1729 }, (_, i) => expense('expense-' + i, { amount: i }));
  read.mockResolvedValueOnce({ docs: rows });
  const result = await readExpenseStatistics('2025-10-01', '2026-09-30');
  expect(read).toHaveBeenCalledTimes(1);
  expect(result).toHaveLength(1729);
  expect(new Set(result.map(row => row.id)).size).toBe(1729);
  expect(result.reduce((total, row) => total + row.amount, 0)).toBe(1729 * 1728 / 2);
});
it('stops between pages when the captured revision is invalidated', async () => {
  let current = true;
  read.mockImplementationOnce(async () => {
    current = false;
    return { docs: Array.from({ length: 5_000 }, (_, i) => expense('expense-' + i)) };
  });
  await expect(readExpenseStatistics('2026-09-01', '2026-09-30', {
    assertCurrent: () => { if (!current) throw new Error('STATISTICS_SESSION_CHANGED'); },
  })).rejects.toThrow('STATISTICS_SESSION_CHANGED');
  expect(read).toHaveBeenCalledTimes(1);
});
it('rejects a failed later page without publishing the first page as a complete total', async () => {
  read.mockResolvedValueOnce({ docs: Array.from({ length: 5_000 }, (_, i) => expense('expense-' + i)) })
    .mockRejectedValueOnce(new Error('later page unavailable'));
  await expect(readExpenseStatistics('2026-09-01', '2026-09-30')).rejects.toThrow('later page unavailable');
  expect(read).toHaveBeenCalledTimes(2);
});
it('keeps the 50,000-document bound and rejects rather than publishing a truncated total', async () => {
  let offset = 0;
  read.mockImplementation(async () => {
    const docs = Array.from({ length: 5_000 }, (_, index) => expense('expense-' + (offset + index)));
    offset += docs.length;
    return { docs };
  });
  await expect(readExpenseStatistics('2026-09-01', '2026-09-30')).rejects.toThrow('STATISTICS_PAGE_LIMIT_EXCEEDED');
  expect(offset).toBe(50_000);
  expect(read).toHaveBeenCalledTimes(10);
});
it('canonical baseline zero and stable archived-owner dimensions replace compatibility rows on the same date', async () => {
  const snapshot = (date: string, total: number) => doc(date, { localDate: date, total, financial: total, byType: { stock: total }, byOwnerRefKey: { 'profile:old': total }, ownerDisplayNames: { 'profile:old': '지아' } });
  read.mockResolvedValueOnce({ docs: [doc('legacy', { assetId: 'TOTAL', date: '2019-01-01', balance: 999 })] })
    .mockResolvedValueOnce({ docs: [snapshot('2019-01-01', 0)] }).mockResolvedValueOnce({ docs: [snapshot('2026-09-03', 50)] });
  const result = await readAssetStatisticsHistory('2026-09-01', '2026-09-30');
  expect(result.filter(row => row.assetId === 'TOTAL').map(row => row.balance)).toEqual([0, 50]);
  expect(result.find(row => row.assetId === 'OWNER_REF_profile:old')).toMatchObject({ ownerKey: 'profile:old', ownerDisplayName: '지아' });
  expect(result.find(row => row.assetId === 'TOTAL' && row.date === '2026-09-03')?.changeAmount).toBe(50);
});
it('period normalization uses Seoul and rejects reversed complete custom months', () => {
  expect(resolveExpenseStatisticsPeriod('3months', '', '', new Date('2026-08-31T15:00:00Z'))).toMatchObject({ startDate: '2026-07-01', endDate: '2026-09-30' });
  expect(resolveExpenseStatisticsPeriod('custom', '2026-09-12', '2026-08-03').error).toBeDefined();
});
