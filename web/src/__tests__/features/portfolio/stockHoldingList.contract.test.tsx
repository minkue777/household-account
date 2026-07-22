import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import StockHoldingList from '@/components/assets/StockHoldingList';
import { updateStockHolding } from '@/lib/assetService';
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
});
