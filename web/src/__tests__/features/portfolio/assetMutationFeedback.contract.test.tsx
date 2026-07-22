import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import GoldHoldingModal from '@/components/assets/GoldHoldingModal';
import StockHoldingModal from '@/components/assets/StockHoldingModal';
import { useGoldHolding } from '@/lib/utils/useGoldHolding';
import { useStockHoldingManager } from '@/lib/utils/useStockHoldingManager';
import type { Asset, StockHolding } from '@/types/asset';

jest.mock('@/lib/utils/useStockHoldingManager', () => ({
  useStockHoldingManager: jest.fn(),
}));

jest.mock('@/lib/utils/useGoldHolding', () => ({
  getGoldPricePerDon: jest.fn(() => 100_000),
  useGoldHolding: jest.fn(),
}));

const mockedUseStockHoldingManager = useStockHoldingManager as jest.MockedFunction<
  typeof useStockHoldingManager
>;
const mockedUseGoldHolding = useGoldHolding as jest.MockedFunction<typeof useGoldHolding>;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'asset-1',
    aggregateVersion: 7,
    householdId: 'house-1',
    name: '투자 계좌',
    type: 'stock',
    currentBalance: 1_000_000,
    currency: 'KRW',
    isActive: true,
    order: 0,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

function holding(): StockHolding {
  return {
    id: 'position-1',
    aggregateVersion: 5,
    assetId: 'asset-1',
    householdId: 'house-1',
    holdingType: 'cash',
    stockCode: '',
    stockName: '예수금',
    market: 'UNRESOLVED',
    quantity: 1,
    currentPrice: 1_000_000,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
  };
}

describe('portfolio optimistic mutation feedback contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('holding delete closes confirmation immediately and sends the version the user confirmed', async () => {
    const command = deferred<boolean>();
    const deleteHolding = jest.fn(() => command.promise);
    mockedUseStockHoldingManager.mockReturnValue({
      holdings: [holding()],
      isLoadingHoldings: false,
      totalHoldingValue: 1_000_000,
      searchQuery: '',
      setSearchQuery: jest.fn(),
      searchResults: [],
      isSearching: false,
      selectedStock: null,
      selectStock: jest.fn(),
      quantity: '',
      setQuantityInput: jest.fn(),
      avgPrice: '',
      setAvgPriceInput: jest.fn(),
      currentPrice: null,
      currentPriceInfo: null,
      isLoadingPrice: false,
      isAddingHolding: false,
      addHolding: jest.fn(),
      manualName: '',
      setManualName: jest.fn(),
      manualCurrentValue: '',
      setManualCurrentValueInput: jest.fn(),
      isAddingManualHolding: false,
      addManualHolding: jest.fn(),
      deleteHolding,
      resetStockForm: jest.fn(),
      resetManualForm: jest.fn(),
      isRefreshingPrices: false,
      refreshHoldingPrices: jest.fn(),
    });
    const user = userEvent.setup();

    render(<StockHoldingModal isOpen onClose={jest.fn()} asset={asset()} />);
    await act(async () => {
      await user.click(screen.getByRole('button', { name: '예수금 삭제' }));
    });
    expect(screen.getByText('보유 종목 삭제')).toBeInTheDocument();

    await act(async () => {
      await user.click(screen.getByRole('button', { name: '삭제' }));
    });

    expect(deleteHolding).toHaveBeenCalledWith('position-1', 5);
    expect(screen.queryByText('보유 종목 삭제')).not.toBeInTheDocument();

    command.resolve(true);
    await command.promise;
  });

  test('gold form stays open when local prevalidation rejects the save', async () => {
    const saveGoldHolding = jest.fn();
    mockedUseGoldHolding.mockReturnValue({
      quantity: '0',
      setQuantityInput: jest.fn(),
      goldPrice: {
        buyPricePerDon: 100_000,
        sellPricePerDon: 100_000,
        timestamp: '2026-07-22T00:00:00.000Z',
      },
      isLoadingPrice: false,
      refreshGoldPrice: jest.fn(),
      totalValue: 0,
      isSaving: false,
      saveGoldHolding,
    });
    const onClose = jest.fn();

    render(
      <GoldHoldingModal
        isOpen
        onClose={onClose}
        asset={asset({ type: 'gold', subType: 'physical' })}
      />
    );

    const saveButton = screen.getByRole('button', { name: '저장' });
    expect(saveButton).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
    expect(saveGoldHolding).not.toHaveBeenCalled();
  });
});
