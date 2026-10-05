import { act, renderHook } from '@testing-library/react';
import { useCryptoHoldingManager } from '@/lib/utils/useCryptoHoldingManager';
import { useStockHoldingManager } from '@/lib/utils/useStockHoldingManager';
import { portfolioQueries } from '@/features/portfolio/application/portfolioQueries';
import type { Asset, CryptoHolding, StockHolding } from '@/types/asset';
import { addCryptoHolding } from '@/lib/assetService';

jest.mock('@/lib/assetService', () => ({
  addStockHolding: jest.fn(),
  deleteStockHolding: jest.fn(),
  refreshAssetMarketValues: jest.fn(),
  addCryptoHolding: jest.fn(),
  deleteCryptoHolding: jest.fn(),
}));

jest.mock('@/features/portfolio/application/portfolioQueries', () => ({
  portfolioQueries: {
    searchStocks: jest.fn(),
    getStockQuote: jest.fn(),
    searchCrypto: jest.fn(),
    getCryptoQuote: jest.fn(),
  },
}));

function asset(id: string, type: Asset['type']): Asset {
  return {
    id,
    aggregateVersion: 1,
    householdId: 'household-1',
    name: id,
    type,
    currentBalance: 0,
    currency: 'KRW',
    isActive: true,
    order: 0,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
  };
}

function stockHolding(id: string, assetId: string): StockHolding {
  return {
    id,
    aggregateVersion: 1,
    householdId: 'household-1',
    assetId,
    stockCode: id,
    stockName: id,
    market: 'KRX',
    quantity: 1,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
  };
}

function cryptoHolding(id: string, assetId: string): CryptoHolding {
  return {
    id,
    aggregateVersion: 1,
    householdId: 'household-1',
    assetId,
    marketCode: id,
    coinName: id,
    quantity: 1,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
  };
}

describe('holding manager in-memory snapshot contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('주식 계좌는 가구 snapshot 중 선택한 계좌 종목만 첫 렌더에 사용한다', () => {
    const { result } = renderHook(() =>
      useStockHoldingManager({
        isOpen: true,
        asset: asset('stock-a', 'stock'),
        holdingsSnapshot: [
          stockHolding('position-a', 'stock-a'),
          stockHolding('position-b', 'stock-b'),
        ],
        holdingsReady: true,
      })
    );

    expect(result.current.isLoadingHoldings).toBe(false);
    expect(result.current.holdings.map(({ id }) => id)).toEqual(['position-a']);
  });

  test('코인 계좌도 별도 조회 없이 가구 snapshot을 계좌별로 투영한다', () => {
    const { result } = renderHook(() =>
      useCryptoHoldingManager({
        isOpen: true,
        asset: asset('crypto-a', 'crypto'),
        holdingsSnapshot: [
          cryptoHolding('position-a', 'crypto-a'),
          cryptoHolding('position-b', 'crypto-b'),
        ],
        holdingsReady: true,
      })
    );

    expect(result.current.isLoadingHoldings).toBe(false);
    expect(result.current.holdings.map(({ id }) => id)).toEqual(['position-a']);
  });

  test('코인 검색도 고정 debounce 없이 입력 직후 서버 검색을 시작한다', async () => {
    const searchCrypto = portfolioQueries.searchCrypto as jest.MockedFunction<
      typeof portfolioQueries.searchCrypto
    >;
    searchCrypto.mockResolvedValue([]);
    const { result } = renderHook(() =>
      useCryptoHoldingManager({
        isOpen: true,
        asset: asset('crypto-a', 'crypto'),
        holdingsReady: true,
      })
    );

    await act(async () => {
      result.current.setSearchQuery('비트코인');
      await Promise.resolve();
    });

    expect(searchCrypto).toHaveBeenCalledWith('비트코인');
  });

  test('코인 역순 응답·선택 취소가 소수 수량과 현재 종목의 제출 가격을 오염시키지 않는다', async () => {
    type Quote = Awaited<ReturnType<typeof portfolioQueries.getCryptoQuote>>;
    let resolveA!: (value: Quote) => void;
    let resolveB!: (value: Quote) => void;
    const pendingA = new Promise<Quote>(resolve => { resolveA = resolve; });
    const pendingB = new Promise<Quote>(resolve => { resolveB = resolve; });
    (portfolioQueries.getCryptoQuote as jest.Mock).mockImplementation(coin => coin.code === 'A' ? pendingA : pendingB);
    (addCryptoHolding as jest.Mock).mockResolvedValue('holding');
    const { result } = renderHook(() => useCryptoHoldingManager({ isOpen: true, asset: asset('crypto-a', 'crypto') }));
    act(() => { void result.current.selectCoin({ code: 'A', name: '코인 A' }); });
    act(() => { void result.current.selectCoin({ code: 'B', name: '코인 B' }); });
    const quote = (code: string, price: number): Quote => ({ code, name: code, price, change: 0, changePercent: 0, previousClose: price, currency: 'KRW' });
    await act(async () => resolveB(quote('B', 200)));
    await act(async () => resolveA(quote('A', 100)));
    expect(result.current.currentPrice).toBe(200);
    act(() => { result.current.setQuantityInput('0.25'); result.current.setAvgPriceInput('180'); });
    await act(async () => { expect(await result.current.addHolding()).toBe(true); });
    expect(addCryptoHolding).toHaveBeenCalledWith({ assetId: 'crypto-a', marketCode: 'B', coinName: '코인 B', quantity: 0.25, avgPrice: 180, currentPrice: 200 });
    act(() => { void result.current.selectCoin({ code: 'A', name: '코인 A' }); result.current.setSearchQuery(''); });
    await act(async () => { await pendingA; });
    expect(result.current.selectedCoin).toBeNull();
    expect(result.current.currentPrice).toBeNull();
  });
});
