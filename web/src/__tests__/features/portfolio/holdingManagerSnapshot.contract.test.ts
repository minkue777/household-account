import { act, renderHook } from '@testing-library/react';
import { useCryptoHoldingManager } from '@/lib/utils/useCryptoHoldingManager';
import { useStockHoldingManager } from '@/lib/utils/useStockHoldingManager';
import { portfolioQueries } from '@/features/portfolio/application/portfolioQueries';
import type { Asset, CryptoHolding, StockHolding } from '@/types/asset';
import { addCryptoHolding, addStockHolding } from '@/lib/assetService';

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


function deferredAdd() {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe.each(['stock', 'crypto', 'manual'] as const)('%s 추가 초안의 저장 수명', kind => {
  let silence: jest.SpyInstance;
  beforeEach(() => {
    jest.resetAllMocks();
    silence = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.mocked(portfolioQueries.getStockQuote).mockResolvedValue({ code: 'A', name: 'A', price: 100, change: 0, changePercent: 0, previousClose: 100, currency: 'KRW' });
    jest.mocked(portfolioQueries.getCryptoQuote).mockResolvedValue({ code: 'A', name: 'A', price: 100, change: 0, changePercent: 0, previousClose: 100, currency: 'KRW' });
  });
  afterEach(() => silence.mockRestore());

  function setup() {
    return renderHook(({ id }) => {
      const stock = useStockHoldingManager({ isOpen: true, asset: asset(id, 'stock') });
      const crypto = useCryptoHoldingManager({ isOpen: true, asset: asset(id, 'crypto') });
      return {
        async fill(name: string) {
          if (kind === 'manual') { stock.setManualName(name); stock.setManualCurrentValueInput('123'); }
          else if (kind === 'stock') { await stock.selectStock({ code: name, name, market: 'KRX' }); stock.setQuantityInput('2'); }
          else { await crypto.selectCoin({ code: name, name }); crypto.setQuantityInput('0.25'); }
        },
        add: kind === 'manual' ? stock.addManualHolding : kind === 'stock' ? stock.addHolding : crypto.addHolding,
        name: kind === 'manual' ? stock.manualName : kind === 'stock' ? stock.searchQuery : crypto.searchQuery,
        pending: kind === 'manual' ? stock.isAddingManualHolding : kind === 'stock' ? stock.isAddingHolding : crypto.isAddingHolding,
      };
    }, { initialProps: { id: 'account-a' } });
  }
  const command = () => jest.mocked(kind === 'crypto' ? addCryptoHolding : addStockHolding);

  test('실패한 초안은 다시 구성하지 않고 그대로 보존하며 재시도 성공 때 비운다', async () => {
    const hook = setup();
    await act(async () => hook.result.current.fill('초안 A'));
    const gate = deferredAdd();
    command().mockReturnValueOnce(gate.promise);
    let pending!: Promise<boolean | undefined>;
    act(() => { pending = hook.result.current.add(); });
    expect(hook.result.current).toMatchObject({ name: '초안 A', pending: true });
    await act(async () => { gate.reject(new Error('FAILED')); expect(await pending).toBe(false); });
    expect(hook.result.current).toMatchObject({ name: '초안 A', pending: false });
    command().mockResolvedValueOnce('saved');
    await act(async () => { expect(await hook.result.current.add()).toBe(true); });
    expect(hook.result.current).toMatchObject({ name: '', pending: false });
  });

  test.each([true, false])('저장 중 새로 입력한 초안은 이전 요청 성공=%s에도 보존한다', async success => {
    const hook = setup();
    await act(async () => hook.result.current.fill('초안 A'));
    const gate = deferredAdd();
    command().mockReturnValueOnce(gate.promise);
    let pending!: Promise<boolean | undefined>;
    act(() => { pending = hook.result.current.add(); });
    await act(async () => hook.result.current.fill('새 초안 B'));
    await act(async () => {
      if (success) gate.resolve('saved'); else gate.reject(new Error('FAILED'));
      expect(await pending).toBe(success);
    });
    expect(hook.result.current).toMatchObject({ name: '새 초안 B', pending: false });
  });

  test('계좌 전환 뒤 이전 실패가 새 계좌의 초안과 진행 상태를 바꾸지 않는다', async () => {
    const hook = setup();
    const first = deferredAdd(), second = deferredAdd();
    command().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await act(async () => hook.result.current.fill('계좌 A'));
    let firstPending!: Promise<boolean | undefined>, secondPending!: Promise<boolean | undefined>;
    act(() => { firstPending = hook.result.current.add(); });
    hook.rerender({ id: 'account-b' });
    expect(hook.result.current.pending).toBe(false);
    await act(async () => hook.result.current.fill('계좌 B'));
    act(() => { secondPending = hook.result.current.add(); });
    await act(async () => { first.reject(new Error('OLD_FAILED')); expect(await firstPending).toBeUndefined(); });
    expect(hook.result.current).toMatchObject({ name: '계좌 B', pending: true });
    await act(async () => { second.resolve('saved'); expect(await secondPending).toBe(true); });
    expect(hook.result.current).toMatchObject({ name: '', pending: false });
    expect(command().mock.calls[0][0].assetId).toBe('account-a');
    expect(command().mock.calls[1][0].assetId).toBe('account-b');
  });
});
