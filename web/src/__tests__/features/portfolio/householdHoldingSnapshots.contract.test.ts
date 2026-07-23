import { act, renderHook } from '@testing-library/react';
import type { CryptoHolding, StockHolding } from '@/types/asset';
import {
  resetHouseholdHoldingSnapshotsForTests,
  useHouseholdHoldingSnapshots,
} from '@/lib/utils/useHouseholdHoldingSnapshots';
import {
  subscribeToHouseholdCryptoHoldings,
  subscribeToHouseholdStockHoldings,
} from '@/lib/assetService';

jest.mock('@/lib/assetService', () => ({
  subscribeToHouseholdStockHoldings: jest.fn(),
  subscribeToHouseholdCryptoHoldings: jest.fn(),
}));

const subscribeStock = subscribeToHouseholdStockHoldings as jest.MockedFunction<
  typeof subscribeToHouseholdStockHoldings
>;
const subscribeCrypto = subscribeToHouseholdCryptoHoldings as jest.MockedFunction<
  typeof subscribeToHouseholdCryptoHoldings
>;

function stockHolding(assetId = 'stock-account'): StockHolding {
  return {
    id: 'stock-position',
    aggregateVersion: 3,
    householdId: 'household-1',
    assetId,
    stockCode: '005930',
    stockName: '삼성전자',
    market: 'KRX',
    quantity: 1,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
  };
}

function cryptoHolding(assetId = 'crypto-account'): CryptoHolding {
  return {
    id: 'crypto-position',
    aggregateVersion: 2,
    householdId: 'household-1',
    assetId,
    marketCode: 'KRW-BTC',
    coinName: '비트코인',
    quantity: 0.1,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
  };
}

describe('household holding snapshot contract', () => {
  let stockCallback: (holdings: StockHolding[]) => void;
  let cryptoCallback: (holdings: CryptoHolding[]) => void;
  const unsubscribeStock = jest.fn();
  const unsubscribeCrypto = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    resetHouseholdHoldingSnapshotsForTests();
    subscribeStock.mockImplementation((callback) => {
      stockCallback = callback;
      return unsubscribeStock;
    });
    subscribeCrypto.mockImplementation((callback) => {
      cryptoCallback = callback;
      return unsubscribeCrypto;
    });
  });

  test('자산 페이지 수명 동안 가구 전체 종목 listener는 종류별 하나만 유지한다', () => {
    const { rerender, unmount } = renderHook(
      ({ householdId }) => useHouseholdHoldingSnapshots(householdId, true),
      { initialProps: { householdId: 'household-1' } }
    );

    expect(subscribeStock).toHaveBeenCalledTimes(1);
    expect(subscribeCrypto).toHaveBeenCalledTimes(1);

    rerender({ householdId: 'household-1' });

    expect(subscribeStock).toHaveBeenCalledTimes(1);
    expect(subscribeCrypto).toHaveBeenCalledTimes(1);

    unmount();
    expect(unsubscribeStock).toHaveBeenCalledTimes(1);
    expect(unsubscribeCrypto).toHaveBeenCalledTimes(1);
  });

  test('listener 갱신을 메모리에 보관하고 다시 들어온 첫 렌더에 즉시 제공한다', () => {
    const first = renderHook(() =>
      useHouseholdHoldingSnapshots('household-1', true)
    );

    act(() => {
      stockCallback([stockHolding()]);
      cryptoCallback([cryptoHolding()]);
    });

    expect(first.result.current).toMatchObject({
      stockHoldings: [expect.objectContaining({ id: 'stock-position' })],
      cryptoHoldings: [expect.objectContaining({ id: 'crypto-position' })],
      stockHoldingsReady: true,
      cryptoHoldingsReady: true,
    });
    first.unmount();

    const revisited = renderHook(() =>
      useHouseholdHoldingSnapshots('household-1', false)
    );

    expect(revisited.result.current).toMatchObject({
      stockHoldings: [expect.objectContaining({ id: 'stock-position' })],
      cryptoHoldings: [expect.objectContaining({ id: 'crypto-position' })],
      stockHoldingsReady: true,
      cryptoHoldingsReady: true,
    });
  });
});
