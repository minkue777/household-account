import { fireEvent, render, screen } from '@testing-library/react';
import AssetHistoryModal from '@/components/assets/AssetHistoryModal';
import type { Asset, StockHolding } from '@/types/asset';
jest.mock('@/lib/assetService', () => ({ addStockHolding: jest.fn(), addCryptoHolding: jest.fn(), refreshAssetMarketValues: jest.fn() }));
jest.mock('@/features/portfolio/application/portfolioQueries', () => ({ portfolioQueries: {
  searchStocks: jest.fn(), getStockQuote: jest.fn(), searchCrypto: jest.fn(), getCryptoQuote: jest.fn(),
} }));
jest.mock('@/contexts/AppDialogContext', () => ({ useAppDialog: () => ({ showAlert: jest.fn() }) }));

const asset: Asset = { id: 'account', aggregateVersion: 1, householdId: 'house', name: '주식', type: 'stock', currentBalance: 10000,
  currency: 'KRW', isActive: true, order: 0, createdAt: new Date(), updatedAt: new Date() };
const holding: StockHolding = { id: 'position', aggregateVersion: 1, householdId: 'house', assetId: 'account', holdingType: 'cash',
  stockCode: 'cash', stockName: '현금', quantity: 1, currentPrice: 12345, market: 'KRX', createdAt: new Date(), updatedAt: new Date() };

test.each(['stock', 'crypto'] as const)('최초 %s 조회 실패는 0원·빈 보유를 표시하지 않고 실제 빈 성공에서만 표시한다', type => {
  const retry = jest.fn();
  const props = { isOpen: true, onClose: jest.fn(), onEditAsset: jest.fn(), asset: { ...asset, type }, stockHoldings: [], cryptoHoldings: [],
    stockHoldingsReady: false, cryptoHoldingsReady: false, onRetryHoldings: retry };
  const view = render(<AssetHistoryModal {...props} stockHoldingsError={new Error('offline')} cryptoHoldingsError={new Error('offline')} />);
  expect(screen.getByText(/평가금액 확인 불가/)).toBeInTheDocument();
  expect(screen.queryByText(/보유 (항목|코인)이 없습니다/)).not.toBeInTheDocument();
  expect(screen.queryByText(/평가금액 0원/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
  expect(retry).toHaveBeenCalledTimes(1);
  view.rerender(<AssetHistoryModal {...props} stockHoldingsReady cryptoHoldingsReady />);
  expect(screen.getByText(/평가금액 0원/)).toBeInTheDocument();
  expect(screen.getByText(/보유 (항목|코인)이 없습니다/)).toBeInTheDocument();
});

test('이전 보유 자료가 있으면 실패 후에도 마지막 평가액을 유지한다', () => {
  render(<AssetHistoryModal isOpen asset={asset} onClose={jest.fn()} onEditAsset={jest.fn()} stockHoldings={[holding]} cryptoHoldings={[]}
    stockHoldingsReady cryptoHoldingsReady stockHoldingsError={new Error('offline')} />);
  expect(screen.getByText(/평가금액 12,345원/)).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('마지막 확인값');
  expect(screen.getByText('현금')).toBeInTheDocument();
});
