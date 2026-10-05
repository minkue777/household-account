import { getHouseholdCommandClient } from '@/composition/webCommandRuntime';
import { clearClientSessionScope, setClientSessionScope } from '@/composition/clientSessionScope';
import { portfolioCommands } from '@/features/portfolio/application/portfolioCommands';
import type { AssetHistoryEntry } from '@/types/asset';
import { invalidateAssetStatisticsCache, peekCachedAssetStatistics, readCachedAssetStatistics } from '@/platform/reporting/assetStatisticsQueryCache';

jest.mock('@/composition/webCommandRuntime', () => ({ getHouseholdCommandClient: jest.fn() }));
const execute = jest.fn();
const readSource = jest.fn();
const readHistory = () => readCachedAssetStatistics('2026-10-05', readSource);
const peekHistory = () => peekCachedAssetStatistics('2026-10-05');
const history = (balance: number): AssetHistoryEntry[] => [{
  id: 'total', householdId: 'house', assetId: 'TOTAL', date: '2026-10-05',
  balance, changeAmount: 0, createdAt: new Date(0),
}];

beforeEach(() => {
  invalidateAssetStatisticsCache();
  setClientSessionScope({ principalUid: 'actor', householdId: 'house', memberId: 'member', sessionGeneration: 1 });
  execute.mockReset().mockResolvedValue({ assetId: 'asset', positionId: 'position', refreshedCount: 1 });
  readSource.mockReset().mockResolvedValueOnce(history(100)).mockResolvedValue(history(200));
  jest.mocked(getHouseholdCommandClient).mockReturnValue({ execute } as never);
});
afterEach(() => { invalidateAssetStatisticsCache(); clearClientSessionScope(); });

const changes: Array<[string, () => Promise<unknown>]> = [
  ['자산 추가', () => portfolioCommands.createAsset('house', { name: '예금', type: 'savings', currentBalance: 100, currency: 'KRW', isActive: true, order: 0 })],
  ['자산 수정', () => portfolioCommands.updateAsset('house', 'asset', { currentBalance: 200 }, 1)],
  ['자산 순서', () => portfolioCommands.reorderAssets('house', [{ id: 'asset', order: 1 }], { asset: 1 })],
  ['자산 삭제', () => portfolioCommands.deleteAsset('house', 'asset', 1)],
  ['보유 종목 추가', () => portfolioCommands.addPosition('house', 'stock', { assetId: 'asset', stockCode: '005930', stockName: '종목', market: 'KRX', quantity: 1 }, undefined, 1)],
  ['보유 종목 수정', () => portfolioCommands.updatePosition('house', 'stock', 'position', 'asset', { quantity: 2 }, 1, 1)],
  ['보유 종목 삭제', () => portfolioCommands.deletePosition('house', 'stock', 'position', 'asset', 1, 1)],
  ['시세 갱신', () => portfolioCommands.refreshMarketValues('house', 'all')],
];

it.each(changes)('%s 성공은 이전 완료값을 폐기하고 통계 재진입에서 원천을 다시 읽는다', async (_name, change) => {
  await expect(readHistory()).resolves.toEqual(history(100));
  expect(peekHistory()).toEqual(history(100));
  expect(readSource).toHaveBeenCalledTimes(1);
  await change();
  expect(peekHistory()).toBeUndefined();
  await expect(readHistory()).resolves.toEqual(history(200));
  expect(readSource).toHaveBeenCalledTimes(2);
});

it('거부된 변경은 완료된 통계 원천을 무효화하지 않는다', async () => {
  await readHistory();
  execute.mockRejectedValueOnce(new Error('VERSION_CONFLICT'));
  await expect(portfolioCommands.updateAsset('house', 'asset', { currentBalance: 200 }, 1)).rejects.toThrow('VERSION_CONFLICT');
  expect(peekHistory()).toEqual(history(100));
  expect(readSource).toHaveBeenCalledTimes(1);
});

it('시세 일부 갱신 실패도 이미 변경된 항목이 있으므로 완료 캐시를 무효화한다', async () => {
  await readHistory();
  execute.mockResolvedValueOnce({ refreshedCount: 1, failedCount: 1 });
  await expect(portfolioCommands.refreshMarketValues('house', 'all')).rejects.toThrow('갱신하지 못했습니다');
  expect(peekHistory()).toBeUndefined();
  await expect(readHistory()).resolves.toEqual(history(200));
  expect(readSource).toHaveBeenCalledTimes(2);
});

it('이전 멤버의 늦은 저장 완료가 다음 멤버의 통계 캐시를 폐기하지 않는다', async () => {
  let complete!: (result: object) => void;
  execute.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
  const previousCommand = portfolioCommands.updateAsset('house', 'asset', { currentBalance: 200 }, 1);
  setClientSessionScope({ principalUid: 'next', householdId: 'house', memberId: 'next', sessionGeneration: 2 });
  await expect(readHistory()).resolves.toEqual(history(100));
  complete({});
  await previousCommand;
  expect(peekHistory()).toEqual(history(100));
  expect(readSource).toHaveBeenCalledTimes(1);
});
