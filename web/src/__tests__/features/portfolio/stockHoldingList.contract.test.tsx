import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import StockHoldingList from '@/components/assets/StockHoldingList';
import CryptoHoldingList from '@/components/assets/CryptoHoldingList';
import { deleteStockHolding, updateStockHolding } from '@/lib/assetService';
import { portfolioQueries } from '@/features/portfolio/application/portfolioQueries';
import type { StockHolding } from '@/types/asset';

jest.mock('@/lib/assetService', () => ({
  deleteStockHolding: jest.fn(),
  updateStockHolding: jest.fn(),
}));

jest.mock('@/features/portfolio/application/portfolioQueries', () => ({
  portfolioQueries: {
    getDividendProjection: jest.fn(),
  },
}));

const mockedUpdateStockHolding = updateStockHolding as jest.MockedFunction<
  typeof updateStockHolding
>;
const mockedDeleteStockHolding = deleteStockHolding as jest.MockedFunction<
  typeof deleteStockHolding
>;
const mockedGetDividendProjection = portfolioQueries.getDividendProjection as jest.MockedFunction<
  typeof portfolioQueries.getDividendProjection
>;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function legacyCashHolding(): StockHolding {
  return {
    id: 'legacy-cash-1',
    aggregateVersion: 3,
    assetId: 'asset-1',
    householdId: 'house-1',
    holdingType: 'cash',
    stockCode: '',
    stockName: '예수금',
    market: 'UNRESOLVED',
    quantity: 1,
    currentPrice: 1_000_000,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
  };
}

function stockHolding(): StockHolding {
  return {
    id: 'stock-1',
    aggregateVersion: 2,
    assetId: 'asset-1',
    householdId: 'house-1',
    holdingType: 'stock',
    stockCode: '005930',
    stockName: '삼성전자',
    market: 'KRX',
    quantity: 10,
    avgPrice: 70_000,
    currentPrice: 80_000,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
  };
}

describe('StockHoldingList 수동 보유 항목 수정 계약', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedGetDividendProjection.mockReturnValue(new Promise(() => {}));
  });

  test('주식과 코인 목록은 정상 0원 시세의 평가액과 100% 손실을 표시한다', () => {
    const stock = { ...stockHolding(), currentPrice: 0 };
    const { unmount } = render(<StockHoldingList holdings={[stock]} isLoading={false} isRefreshing={false} onRefresh={jest.fn()} assetId="asset-1" />);
    expect(screen.getByText(/-100\.00%/)).toBeInTheDocument();
    expect(screen.getByText('0원')).toBeInTheDocument();
    unmount();
    render(<CryptoHoldingList holdings={[{ id: 'coin-1', aggregateVersion: 1, householdId: 'house-1', assetId: 'asset-1', marketCode: 'KRW-BTC', coinName: '비트코인', quantity: 1, avgPrice: 100, currentPrice: 0, createdAt: new Date(), updatedAt: new Date() }]} isLoading={false} isRefreshing={false} onRefresh={jest.fn()} assetId="asset-1" />);
    expect(screen.getByText(/-100\.00%/)).toBeInTheDocument();
    expect(screen.getByText('0원')).toBeInTheDocument();
  });

  test('[T-HOLD-001][HOLD-001] 예수금 금액을 저장하면 전송 불가능한 undefined 없이 즉시 편집 화면을 닫는다', async () => {
    const command = deferred<void>();
    mockedUpdateStockHolding.mockReturnValue(command.promise);
    const user = userEvent.setup();

    render(
      <StockHoldingList
        holdings={[legacyCashHolding()]}
        isLoading={false}
        isRefreshing={false}
        onRefresh={jest.fn()}
        assetId="asset-1"
      />
    );

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /예수금/ }));
    });
    const amountInput = screen.getByLabelText('금액');
    await act(async () => {
      await user.clear(amountInput);
      await user.type(amountInput, '1500000');
      await user.click(screen.getByRole('button', { name: '저장' }));
    });

    expect(mockedUpdateStockHolding).toHaveBeenCalledWith(
      'legacy-cash-1',
      'asset-1',
      {
        stockName: '예수금',
        quantity: 1,
        currentPrice: 1_500_000,
      },
      3,
      legacyCashHolding()
    );
    expect(screen.queryByLabelText('금액')).not.toBeInTheDocument();

    await act(async () => {
      command.resolve();
      await command.promise;
    });
  });

  test('[T-HOLD-002][HOLD-001] 예수금 삭제는 읽은 버전으로 삭제 명령을 보내고 목록에서 즉시 제거한다', async () => {
    const command = deferred<void>();
    mockedDeleteStockHolding.mockReturnValue(command.promise);
    const user = userEvent.setup();

    render(
      <StockHoldingList
        holdings={[legacyCashHolding()]}
        isLoading={false}
        isRefreshing={false}
        onRefresh={jest.fn()}
        assetId="asset-1"
      />
    );

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /예수금/ }));
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: '삭제' }));
    });
    const deleteButtons = screen.getAllByRole('button', { name: '삭제' });
    await act(async () => {
      await user.click(deleteButtons[deleteButtons.length - 1]);
    });

    expect(mockedDeleteStockHolding).toHaveBeenCalledWith(
      'legacy-cash-1',
      'asset-1',
      3,
      legacyCashHolding()
    );
    expect(screen.queryByLabelText('금액')).not.toBeInTheDocument();

    await act(async () => {
      command.resolve();
      await command.promise;
    });
  });

  test('[T-PERF-HOLD-001][HOLD-005] 목록을 먼저 표시하고 클릭 없이 배당을 표시하며 같은 종목은 한 번 조회한다', async () => {
    const dividendQuery =
      deferred<Awaited<ReturnType<typeof portfolioQueries.getDividendProjection>>>();
    const dividendProjection: Awaited<
      ReturnType<typeof portfolioQueries.getDividendProjection>
    > = {
      code: '005930',
      name: '삼성전자',
      recentDividend: 360,
      paymentDate: '2026-05-20',
      frequency: 4,
      dividendYield: 2,
      annualDividendPerShare: 1_440,
      isEstimated: false,
      paymentEvents: [],
    };
    mockedGetDividendProjection.mockReturnValue(dividendQuery.promise);
    const user = userEvent.setup();

    const holdings = [stockHolding(), { ...stockHolding(), id: 'stock-2' }, legacyCashHolding()];
    const props = { holdings, isLoading: false, isRefreshing: false, onRefresh: jest.fn(), assetId: 'asset-1' };
    const { rerender } = render(
      <StockHoldingList
        {...props}
      />
    );

    expect(screen.getAllByRole('button', { name: /삼성전자/ })).toHaveLength(2);
    expect(screen.getAllByText('배당 정보를 불러오는 중입니다.')).toHaveLength(2);
    expect(mockedGetDividendProjection).toHaveBeenCalledTimes(1);
    expect(mockedGetDividendProjection).toHaveBeenCalledWith('005930');

    await act(async () => {
      dividendQuery.resolve(dividendProjection);
      await dividendQuery.promise;
    });
    expect(screen.getAllByText('최근 지급 360원 · 연 4회')).toHaveLength(2);
    expect(screen.getAllByText('최근 지급일: 2026-05-20')).toHaveLength(2);
    expect(screen.getAllByText('배당수익률 2.00%')).toHaveLength(2);
    expect(screen.queryByLabelText('수량')).not.toBeInTheDocument();

    // 시세 snapshot/배열 순서와 편집 상태 변경은 같은 종목을 재조회하지 않습니다.
    rerender(<StockHoldingList {...props} holdings={[...holdings].reverse().map(h => ({ ...h, currentPrice: 90_000 }))} />);
    await act(async () => { await user.click(screen.getAllByRole('button', { name: /삼성전자/ })[0]); });
    await act(async () => { await user.click(screen.getByText('삼성전자', { selector: '.bg-blue-50 p' })); });
    expect(mockedGetDividendProjection).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('최근 지급 360원 · 연 4회')).toHaveLength(2);
  });

  test('[HOLD-005] 늦게 들어온 보유 목록도 자동 조회하며 실패한 종목이 다른 배당 표시를 막지 않는다', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockedGetDividendProjection.mockImplementation(async code => {
      if (code === '005930') throw new Error('network unavailable');
      return { code, name: '배당 ETF', recentDividend: 100, paymentDate: '2026-10-02', frequency: 12, dividendYield: 3, annualDividendPerShare: 1_200, isEstimated: false, paymentEvents: [] };
    });
    const props = { isLoading: true, isRefreshing: false, onRefresh: jest.fn(), assetId: 'asset-1' };
    const { rerender } = render(<StockHoldingList {...props} holdings={[]} />);
    expect(mockedGetDividendProjection).not.toHaveBeenCalled();
    const holdings = [stockHolding(), { ...stockHolding(), id: 'etf', stockCode: '069500', stockName: '배당 ETF' }, legacyCashHolding(), { ...stockHolding(), id: 'manual', holdingType: 'manual' as const }, { ...stockHolding(), id: 'invalid', stockCode: '' }];
    await act(async () => { rerender(<StockHoldingList {...props} isLoading={false} holdings={holdings} />); });
    expect(mockedGetDividendProjection).toHaveBeenCalledTimes(2);
    expect(screen.getByText('배당 정보를 불러오지 못했습니다.')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /배당 ETF/ })).getByText('최근 지급 100원 · 연 12회')).toBeInTheDocument();
    expect(screen.queryByText('배당 정보를 불러오는 중입니다.')).not.toBeInTheDocument();
    errorLog.mockRestore();
  });

  test('[HOLD-005] 계좌 전환 시 이전 응답은 버리고 재진입하면 최근 배당을 다시 조회한다', async () => {
    const oldQuery = deferred<Awaited<ReturnType<typeof portfolioQueries.getDividendProjection>>>();
    const projection: Awaited<ReturnType<typeof portfolioQueries.getDividendProjection>> = { code: '005930', name: '삼성전자', recentDividend: 360, paymentDate: '2026-05-20', frequency: 4, dividendYield: 2, annualDividendPerShare: 1_440, isEstimated: false, paymentEvents: [] };
    mockedGetDividendProjection.mockReturnValueOnce(oldQuery.promise).mockResolvedValue({ ...projection, recentDividend: 400, paymentDate: '2026-08-20' });
    const props = { holdings: [stockHolding()], isLoading: false, isRefreshing: false, onRefresh: jest.fn(), assetId: 'asset-1' };
    const { rerender, unmount } = render(<StockHoldingList {...props} />);
    await act(async () => { rerender(<StockHoldingList {...props} assetId="asset-2" />); });
    expect(screen.getByText('최근 지급 400원 · 연 4회')).toBeInTheDocument();
    await act(async () => { oldQuery.resolve(projection); await oldQuery.promise; });
    expect(screen.queryByText('최근 지급 360원 · 연 4회')).not.toBeInTheDocument();
    unmount();
    mockedGetDividendProjection.mockResolvedValue({ ...projection, recentDividend: 420 });
    await act(async () => { render(<StockHoldingList {...props} />); });
    expect(screen.getByText('최근 지급 420원 · 연 4회')).toBeInTheDocument();
    expect(mockedGetDividendProjection).toHaveBeenCalledTimes(3);
  });

  test.each([0, 0.64])('[MARKET-001] 가구 배당 이력이 없어도 공급자가 제공한 배당수익률 %s를 표시한다', async dividendYield => {
    mockedGetDividendProjection.mockResolvedValue({ code: '005930', name: '삼성전자', recentDividend: null, paymentDate: null, frequency: null, dividendYield, annualDividendPerShare: null, isEstimated: false, paymentEvents: [] });
    await act(async () => { render(<StockHoldingList holdings={[stockHolding()]} isLoading={false} isRefreshing={false} onRefresh={jest.fn()} assetId="asset-1" />); });
    expect(screen.getByText(`배당수익률 ${dividendYield.toFixed(2)}%`)).toBeInTheDocument();
    expect(screen.queryByText(/최근 지급/)).not.toBeInTheDocument();
    expect(screen.queryByText(/연간 추정/)).not.toBeInTheDocument();
  });
});
