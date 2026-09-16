import { act, renderHook } from '@testing-library/react';
import type { CryptoHolding, StockHolding } from '@/types/asset';
import { clearClientSessionScope, setClientSessionScope } from '@/composition/clientSessionScope';
import { resetLoadedClientSessionState } from '@/composition/clientSessionResetRegistry';
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
    setClientSessionScope({ principalUid: 'uid', householdId: 'household-1', memberId: 'member-1', sessionGeneration: 1 });
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

  test('같은 가구의 멤버가 바뀌면 이전 snapshot과 늦은 callback을 재사용하지 않는다', () => {
    const hook = renderHook(() => useHouseholdHoldingSnapshots('household-1', true));
    act(() => stockCallback([stockHolding()]));
    const previousStock = stockCallback;
    const previousCrypto = cryptoCallback;
    setClientSessionScope({ principalUid: 'uid', householdId: 'household-1', memberId: 'member-2', sessionGeneration: 2 });
    hook.rerender();
    expect(hook.result.current.stockHoldings).toEqual([]);
    act(() => stockCallback([{ ...stockHolding(), id: 'new-member-position' }]));
    act(() => { previousStock([stockHolding()]); previousCrypto([cryptoHolding()]); });
    expect(hook.result.current.stockHoldings.map(item => item.id)).toEqual(['new-member-position']);
    expect(hook.result.current.cryptoHoldings).toEqual([]);
  });

  test('로그아웃 reset은 구독을 즉시 끝내고 늦은 callback이나 같은 가구 재로그인으로 복원하지 않는다', () => {
    const hook = renderHook(() => useHouseholdHoldingSnapshots('household-1', true));
    act(() => { stockCallback([stockHolding()]); cryptoCallback([cryptoHolding()]); });
    const lateStock = stockCallback;
    const lateCrypto = cryptoCallback;
    act(() => { clearClientSessionScope(); resetLoadedClientSessionState(); });
    expect(unsubscribeStock).toHaveBeenCalledTimes(1);
    expect(unsubscribeCrypto).toHaveBeenCalledTimes(1);
    expect(hook.result.current.stockHoldings).toEqual([]);
    act(() => { lateStock([stockHolding()]); lateCrypto([cryptoHolding()]); });
    hook.unmount();
    expect(unsubscribeStock).toHaveBeenCalledTimes(1);
    setClientSessionScope({ principalUid: 'uid', householdId: 'household-1', memberId: 'member-1', sessionGeneration: 2 });
    const reopened = renderHook(() => useHouseholdHoldingSnapshots('household-1', false));
    expect(reopened.result.current).toMatchObject({ stockHoldings: [], cryptoHoldings: [], stockHoldingsReady: false });
  });

  test('remote epoch 교체 후 이전 listener는 최신 entry를 덮지 않는다', () => {
    const hook = renderHook(({ epoch }) => useHouseholdHoldingSnapshots('household-1', true, epoch), { initialProps: { epoch: 0 } });
    const previous = stockCallback;
    hook.rerender({ epoch: 1 });
    act(() => stockCallback([{ ...stockHolding(), id: 'fresh' }]));
    act(() => previous([stockHolding()]));
    expect(hook.result.current.stockHoldings.map(item => item.id)).toEqual(['fresh']);
  });

  test('두 번째 구독 설정 실패 시 첫 번째 listener도 종료한다', () => {
    subscribeCrypto.mockImplementationOnce(() => { throw new Error('setup failed'); });
    const hook = renderHook(() => useHouseholdHoldingSnapshots('household-1', true));
    expect(unsubscribeStock).toHaveBeenCalledTimes(1);
    act(() => stockCallback([stockHolding()]));
    expect(hook.result.current.stockHoldings).toEqual([]);
    hook.unmount();
    expect(unsubscribeStock).toHaveBeenCalledTimes(1);
  });
});
