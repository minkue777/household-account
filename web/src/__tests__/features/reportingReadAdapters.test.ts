import { readExpenseStatistics } from '@/platform/reporting/expenseStatisticsReadModel';
import { readAssetStatisticsHistory } from '@/platform/reporting/assetStatisticsReadModel';
import { getDocsFromServer, where, limit, startAfter } from '@/platform/read-model/firestoreReadModel';
import { resolveExpenseStatisticsPeriod } from '@/features/reporting/statisticsPeriod';

let mockScope = { householdId: 'home', principalUid: 'uid', sessionGeneration: 1 };
jest.mock('@/composition/clientSessionScope', () => ({ requireClientSessionScope: () => mockScope, getClientSessionScope: () => mockScope }));
jest.mock('@/platform/read-model/firestoreReadModel', () => ({ db: {}, collection: jest.fn((_db, ...path) => path.join('/')), query: jest.fn((...args) => args), where: jest.fn((...args) => args), orderBy: jest.fn(), documentId: jest.fn(), startAfter: jest.fn(), limit: jest.fn(), getDocsFromServer: jest.fn() }));
const read = getDocsFromServer as jest.Mock;
const doc = (id: string, values: Record<string, unknown>) => ({ id, data: () => values });
const expense = (id: string, extra = {}) => doc(id, { householdId: 'home', date: '2026-09-01', amount: 0, category: 'food', transactionType: 'expense', ...extra });
beforeEach(() => { jest.clearAllMocks(); mockScope = { householdId: 'home', principalUid: 'uid', sessionGeneration: 1 }; });

it('reads every bounded expense page before publishing and excludes income/deleted rows using the actual mapper', async () => {
  read.mockResolvedValueOnce({ docs: Array.from({ length: 50 }, (_, i) => expense('a' + i)) }).mockResolvedValueOnce({ docs: [expense('income', { transactionType: 'income' }), expense('deleted', { lifecycleState: 'deleted' }), expense('last', { amount: 10 })] });
  const result = await readExpenseStatistics('2026-09-01', '2026-09-30');
  expect(result).toHaveLength(51); expect(result.reduce((sum, row) => sum + row.amount, 0)).toBe(10);
  expect(where).toHaveBeenCalledWith('date', '>=', '2026-09-01'); expect(where).toHaveBeenCalledWith('date', '<=', '2026-09-30');
  expect(limit).toHaveBeenCalledWith(50); expect(startAfter).toHaveBeenCalledTimes(1);
});
it('rejects repeated cursor records and previous-session replies instead of publishing partial success', async () => {
  const rows = Array.from({ length: 50 }, (_, i) => expense('a' + i));
  read.mockResolvedValue({ docs: rows });
  await expect(readExpenseStatistics('2026-09-01', '2026-09-30')).rejects.toThrow('STATISTICS_CURSOR_REPEATED');
  read.mockImplementationOnce(async () => { mockScope = { ...mockScope, sessionGeneration: 2 }; return { docs: [] }; });
  await expect(readExpenseStatistics('2026-09-01', '2026-09-30')).rejects.toThrow('STATISTICS_SESSION_CHANGED');
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
