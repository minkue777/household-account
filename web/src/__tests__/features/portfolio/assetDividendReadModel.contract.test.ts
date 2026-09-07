import {
  clearClientSessionScope,
  setClientSessionScope,
  type ClientSessionScope,
} from '@/composition/clientSessionScope';
import { getAllStockHoldings, getDividendEventsByYear, getDividendSnapshot } from '@/lib/assetService';
import { readAssetDividendStatistics } from '@/platform/reporting/assetDividendReadModel';

jest.mock('@/lib/assetService', () => ({
  getAllStockHoldings: jest.fn(), getDividendEventsByYear: jest.fn(), getDividendSnapshot: jest.fn(),
}));

const scope: ClientSessionScope = { principalUid: 'uid', householdId: 'house', memberId: 'member', sessionGeneration: 1, accessMode: 'member' };
const snapshot = { monthlyData: [100, ...Array(11).fill(0)], events: {} };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

beforeEach(() => {
  setClientSessionScope(scope);
  jest.mocked(getAllStockHoldings).mockReset().mockResolvedValue([]);
  jest.mocked(getDividendSnapshot).mockReset().mockResolvedValue(snapshot);
  jest.mocked(getDividendEventsByYear).mockReset().mockResolvedValue([]);
});
afterEach(clearClientSessionScope);

it('starts all independent sources together and publishes only their complete result', async () => {
  const pending = deferred<typeof snapshot>();
  jest.mocked(getDividendSnapshot).mockReturnValueOnce(pending.promise);
  let completed = false;
  const result = readAssetDividendStatistics(2026).then(value => { completed = true; return value; });
  expect(getAllStockHoldings).toHaveBeenCalledTimes(1);
  expect(getDividendSnapshot).toHaveBeenCalledWith(2026);
  expect(getDividendEventsByYear).toHaveBeenCalledWith(2026);
  await Promise.resolve();
  expect(completed).toBe(false);
  pending.resolve(snapshot);
  await expect(result).resolves.toEqual({ allHoldings: [], snapshot, events: [] });
});

it.each([
  { principalUid: 'other' }, { householdId: 'other' }, { memberId: 'other' },
  { sessionGeneration: 2 }, { accessMode: 'administrator-readonly' as const },
])('rejects a completed dividend source after actor field changes: %j', async change => {
  const pending = deferred<typeof snapshot>();
  jest.mocked(getDividendSnapshot).mockReturnValueOnce(pending.promise);
  const result = readAssetDividendStatistics(2026);
  const rejected = expect(result).rejects.toThrow('STATISTICS_SESSION_CHANGED');
  setClientSessionScope({ ...scope, ...change });
  pending.resolve(snapshot);
  await rejected;
});

it('rejects a completed source after its page/epoch ownership was cancelled', async () => {
  const pending = deferred<typeof snapshot>();
  jest.mocked(getDividendSnapshot).mockReturnValueOnce(pending.promise);
  let active = true;
  const result = readAssetDividendStatistics(2026, () => {
    if (!active) throw new Error('STATISTICS_SESSION_CHANGED');
  });
  const rejected = expect(result).rejects.toThrow('STATISTICS_SESSION_CHANGED');
  active = false;
  pending.resolve(snapshot);
  await rejected;
});

it('does not start dividend reads without a verified actor', async () => {
  clearClientSessionScope();
  await expect(readAssetDividendStatistics(2026)).rejects.toThrow('STATISTICS_SESSION_CHANGED');
  expect(getAllStockHoldings).not.toHaveBeenCalled();
  expect(getDividendSnapshot).not.toHaveBeenCalled();
  expect(getDividendEventsByYear).not.toHaveBeenCalled();
});

it('does not reuse a completed source for a later refresh', async () => {
  await readAssetDividendStatistics(2026);
  jest.mocked(getDividendSnapshot).mockResolvedValueOnce(null);
  await expect(readAssetDividendStatistics(2026)).resolves.toEqual({ allHoldings: [], snapshot: null, events: [] });
  expect(getDividendSnapshot).toHaveBeenCalledTimes(2);
});
