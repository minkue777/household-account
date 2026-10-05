import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AssetAddModal from '@/components/assets/AssetAddModal';
import { addAsset, addStockHolding } from '@/lib/assetService';
import { portfolioQueries } from '@/features/portfolio/application/portfolioQueries';
import type { StockSearchState } from '@/components/assets/StockSearchForm';
import type { StockPriceInfo, StockSearchResult } from '@/types/asset';

const mockShowAlert = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/assetService', () => ({ addAsset: jest.fn(), addStockHolding: jest.fn(), addCryptoHolding: jest.fn() }));
jest.mock('@/contexts/AppDialogContext', () => ({ useAppDialog: () => ({ showAlert: mockShowAlert }) }));
jest.mock('@/features/portfolio/application/portfolioQueries', () => ({ portfolioQueries: {
  searchStocks: jest.fn().mockResolvedValue([]), searchCrypto: jest.fn().mockResolvedValue([]), getStockQuote: jest.fn(), getCryptoQuote: jest.fn(),
} }));
jest.mock('@/components/assets/StockSearchForm', () => ({ __esModule: true, default: ({ state, onAdd }: { state: StockSearchState; onAdd: () => void }) => <div>
  <button onClick={() => state.selectStock({ code: 'A', name: '주식 A', market: 'KRX' })}>A 선택</button>
  <button onClick={() => state.selectStock({ code: 'B', name: '주식 B', market: 'KRX' })}>B 선택</button>
  <button onClick={() => state.setSearchQuery('')}>선택 취소</button>
  <button onClick={() => state.setQuantityInput('3')}>수량 입력</button>
  <button onClick={onAdd}>초안에 종목 추가</button>
  <output data-testid="quote">{state.selectedStock?.code}:{state.currentPrice ?? '없음'}</output>
</div> }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const owners = [{ key: 'child', label: '지운', ownerRef: { kind: 'profile' as const, profileId: 'child' } }];
const quote = (instrument: StockSearchResult, price: number): StockPriceInfo => ({ ...instrument, price, change: 0, changePercent: 0, previousClose: price, currency: 'KRW', priceScale: 1 });

beforeEach(() => { jest.clearAllMocks(); (addAsset as jest.Mock).mockResolvedValue('account'); (addStockHolding as jest.Mock).mockResolvedValue('holding'); });

test('[HOLD-001] A→B 역순 시세 응답과 명의 목록 재조회가 B 종목 초안·실제 제출 값을 바꾸지 않는다', async () => {
  const a = deferred<StockPriceInfo>();
  const b = deferred<StockPriceInfo>();
  (portfolioQueries.getStockQuote as jest.Mock).mockImplementation(stock => stock.code === 'A' ? a.promise : b.promise);
  const props = { isOpen: true, onClose: jest.fn(), defaultType: 'stock' as const, defaultOwnerKey: 'child', ownerOptions: owners };
  const { rerender } = render(<AssetAddModal {...props} />);
  fireEvent.change(screen.getByPlaceholderText('예: 주식계좌, ISA, 연금저축'), { target: { value: '지운 주식' } });
  fireEvent.click(screen.getByText('A 선택'));
  fireEvent.click(screen.getByText('B 선택'));
  await act(async () => b.resolve(quote({ code: 'B', name: '주식 B', market: 'KRX' }, 200)));
  await act(async () => a.resolve(quote({ code: 'A', name: '주식 A', market: 'KRX' }, 100)));
  expect(screen.getByTestId('quote')).toHaveTextContent('B:200');
  rerender(<AssetAddModal {...props} ownerOptions={owners.map(owner => ({ ...owner }))} />);
  expect(screen.getByDisplayValue('지운 주식')).toBeInTheDocument();
  expect(screen.getByTestId('quote')).toHaveTextContent('B:200');
  fireEvent.click(screen.getByText('수량 입력'));
  fireEvent.click(screen.getByText('초안에 종목 추가'));
  fireEvent.click(screen.getByRole('button', { name: '추가' }));
  await waitFor(() => expect(addStockHolding).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'account', stockCode: 'B', quantity: 3, currentPrice: 200 })));
  expect(addAsset).toHaveBeenCalledWith(expect.objectContaining({ name: '지운 주식', ownerRef: owners[0].ownerRef }));
});

test('[AST-001] 편집 중 삭제된 명의를 가구 명의로 바꿔 저장하지 않는다', async () => {
  const props = { isOpen: true, onClose: jest.fn(), defaultType: 'savings' as const, defaultOwnerKey: 'child', ownerOptions: owners };
  const { rerender } = render(<AssetAddModal {...props} />);
  fireEvent.change(screen.getByPlaceholderText('예: 비상금 통장, 체크카드'), { target: { value: '지운 적금' } });
  rerender(<AssetAddModal {...props} ownerOptions={[{ key: 'household', label: '가구', ownerRef: { kind: 'household' } }]} />);
  fireEvent.click(screen.getByRole('button', { name: '추가' }));
  await waitFor(() => expect(mockShowAlert).toHaveBeenCalledWith(expect.stringContaining('명의를 다시 선택')));
  expect(addAsset).not.toHaveBeenCalled();
  expect(screen.getByDisplayValue('지운 적금')).toBeInTheDocument();
});

test('[HOLD-001] 닫은 편집의 시세 응답은 다시 연 창으로 돌아오지 않는다', async () => {
  const pending = deferred<StockPriceInfo>();
  (portfolioQueries.getStockQuote as jest.Mock).mockReturnValue(pending.promise);
  const props = { isOpen: true, onClose: jest.fn(), defaultType: 'stock' as const, ownerOptions: owners };
  const { rerender } = render(<AssetAddModal {...props} />);
  fireEvent.click(screen.getByText('A 선택'));
  rerender(<AssetAddModal {...props} isOpen={false} />);
  rerender(<AssetAddModal {...props} />);
  await act(async () => pending.resolve(quote({ code: 'A', name: '주식 A', market: 'KRX' }, 100)));
  expect(screen.getByTestId('quote')).toHaveTextContent(':없음');
});
