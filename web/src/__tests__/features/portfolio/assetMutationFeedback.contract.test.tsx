import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import AssetHistoryModal from '@/components/assets/AssetHistoryModal';
import { useAppDialog } from '@/contexts/AppDialogContext';
import { useCryptoHoldingManager } from '@/lib/utils/useCryptoHoldingManager';
import { useStockHoldingManager } from '@/lib/utils/useStockHoldingManager';
import type { Asset } from '@/types/asset';

jest.mock('@/contexts/AppDialogContext', () => ({
  useAppDialog: jest.fn(),
}));

jest.mock('@/lib/utils/useStockHoldingManager', () => ({
  useStockHoldingManager: jest.fn(),
}));

jest.mock('@/lib/utils/useCryptoHoldingManager', () => ({
  useCryptoHoldingManager: jest.fn(),
}));

jest.mock('@/components/assets/StockHoldingList', () => () => null);
jest.mock('@/components/assets/CryptoHoldingList', () => () => null);

const mockedUseAppDialog = jest.mocked(useAppDialog);
const mockedUseStockHoldingManager = jest.mocked(useStockHoldingManager);
const mockedUseCryptoHoldingManager = jest.mocked(useCryptoHoldingManager);

function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'asset-1',
    aggregateVersion: 3,
    householdId: 'house-1',
    name: '주식 계좌',
    type: 'stock',
    currentBalance: 0,
    currency: 'KRW',
    isActive: true,
    order: 0,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

function stockManager(addHolding: jest.Mock) {
  return {
    holdings: [],
    isLoadingHoldings: false,
    totalHoldingValue: 0,
    searchQuery: '삼성전자',
    setSearchQuery: jest.fn(),
    searchResults: [],
    isSearching: false,
    selectedStock: {
      code: '005930',
      name: '삼성전자',
      market: 'KRX',
      instrumentType: 'stock',
    },
    selectStock: jest.fn(),
    quantity: '1',
    setQuantityInput: jest.fn(),
    avgPrice: '',
    setAvgPriceInput: jest.fn(),
    currentPrice: 100_000,
    currentPriceInfo: null,
    isLoadingPrice: false,
    isAddingHolding: false,
    addHolding,
    manualName: '',
    setManualName: jest.fn(),
    manualCurrentValue: '',
    setManualCurrentValueInput: jest.fn(),
    isAddingManualHolding: false,
    addManualHolding: jest.fn(),
    deleteHolding: jest.fn(),
    resetStockForm: jest.fn(),
    resetManualForm: jest.fn(),
    isRefreshingPrices: false,
    refreshHoldingPrices: jest.fn(),
  } as unknown as ReturnType<typeof useStockHoldingManager>;
}

function cryptoManager() {
  return {
    holdings: [],
    isLoadingHoldings: false,
    totalHoldingValue: 0,
    searchQuery: '',
    setSearchQuery: jest.fn(),
    searchResults: [],
    isSearching: false,
    selectedCoin: null,
    selectCoin: jest.fn(),
    quantity: '',
    setQuantityInput: jest.fn(),
    avgPrice: '',
    setAvgPriceInput: jest.fn(),
    currentPrice: null,
    isLoadingPrice: false,
    isAddingHolding: false,
    addHolding: jest.fn(),
    deleteHolding: jest.fn(),
    resetCryptoForm: jest.fn(),
    isRefreshingPrices: false,
    refreshHoldingPrices: jest.fn(),
  } as unknown as ReturnType<typeof useCryptoHoldingManager>;
}

describe('실제 자산 상세 mutation feedback 계약', () => {
  test('보유 종목 추가가 실패하면 닫힌 Promise로 삼키지 않고 앱 알림을 표시한다', async () => {
    const showAlert = jest.fn().mockResolvedValue(undefined);
    const addHolding = jest.fn().mockResolvedValue(false);
    mockedUseAppDialog.mockReturnValue({
      showAlert,
      showConfirm: jest.fn(),
      showPrompt: jest.fn(),
    });
    mockedUseStockHoldingManager.mockReturnValue(stockManager(addHolding));
    mockedUseCryptoHoldingManager.mockReturnValue(cryptoManager());

    render(
      <AssetHistoryModal
        isOpen
        onClose={jest.fn()}
        asset={asset()}
        onEditAsset={jest.fn()}
        stockHoldings={[]}
        cryptoHoldings={[]}
        stockHoldingsReady
        cryptoHoldingsReady
      />
    );

    await userEvent.click(screen.getByRole('button', { name: '종목 추가' }));

    await waitFor(() => {
      expect(addHolding).toHaveBeenCalledTimes(1);
      expect(showAlert).toHaveBeenCalledWith('보유 종목 추가에 실패했습니다.');
    });
  });
});
