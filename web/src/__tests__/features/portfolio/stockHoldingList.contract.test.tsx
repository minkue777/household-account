import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import StockHoldingList from '@/components/assets/StockHoldingList';
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
    jest.clearAllMocks();
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
      3
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
      3
    );
    expect(screen.queryByLabelText('금액')).not.toBeInTheDocument();

    await act(async () => {
      command.resolve();
      await command.promise;
    });
  });

  test('[T-PERF-HOLD-001][HOLD-005] 계좌 첫 표시는 종목별 배당 조회를 기다리지 않고 선택한 종목만 조회한다', async () => {
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

    render(
      <StockHoldingList
        holdings={[stockHolding()]}
        isLoading={false}
        isRefreshing={false}
        onRefresh={jest.fn()}
        assetId="asset-1"
      />
    );

    expect(mockedGetDividendProjection).not.toHaveBeenCalled();

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /삼성전자/ }));
      await Promise.resolve();
    });

    expect(mockedGetDividendProjection).toHaveBeenCalledTimes(1);
    expect(mockedGetDividendProjection).toHaveBeenCalledWith('005930');
    expect(screen.getByDisplayValue('10')).toBeInTheDocument();

    await act(async () => {
      dividendQuery.resolve(dividendProjection);
      await dividendQuery.promise;
    });
  });
});
