import { fireEvent, render, screen, within } from '@testing-library/react';
import StockSearchForm, { type StockSearchState } from '@/components/assets/StockSearchForm';
import type { StockSearchResult } from '@/types/asset';

const results: StockSearchResult[] = Array.from({ length: 65 }, (_, index) => ({
  market: 'KRX', instrumentType: 'etf', code: String(100000 + index), name: `검색 ETF ${index}`,
}));
function state(overrides: Partial<StockSearchState> = {}): StockSearchState {
  return {
    searchQuery: '검색', setSearchQuery: jest.fn(), searchResults: results,
    isSearching: false, selectedStock: null, selectStock: jest.fn(),
    quantity: '', setQuantityInput: jest.fn(), avgPrice: '', setAvgPriceInput: jest.fn(),
    currentPrice: null, isLoadingPrice: false, isAddingHolding: false, ...overrides,
  };
}

describe('[MARKET-003][T-MARKET-005] 모든 검색 결과에 접근', () => {
  test('스크롤과 더 보기로 마지막 묶음까지 확장하고 마지막 종목을 선택한다', () => {
    const selectStock = jest.fn();
    render(<StockSearchForm state={state({ selectStock })} onAdd={jest.fn()} />);
    const region = screen.getByRole('region', { name: '종목 검색 결과' });
    const stocks = () => within(region).getAllByRole('button', { name: /^검색 ETF/ });
    expect(stocks()).toHaveLength(30);
    Object.defineProperties(region, {
      clientHeight: { value: 192 }, scrollHeight: { value: 1500 }, scrollTop: { value: 1300, writable: true },
    });
    fireEvent.scroll(region);
    expect(stocks()).toHaveLength(60);
    fireEvent.click(within(region).getByRole('button', { name: '더 보기' }));
    expect(stocks()).toHaveLength(65);
    expect(within(region).queryByRole('button', { name: '더 보기' })).not.toBeInTheDocument();
    fireEvent.click(within(region).getByRole('button', { name: '검색 ETF 64 100064' }));
    expect(selectStock).toHaveBeenCalledWith(results[64]);
  });

  test('검색어 변경은 목록 DOM과 스크롤·표시 범위를 초기화한다', () => {
    const { rerender } = render(<StockSearchForm state={state()} onAdd={jest.fn()} />);
    const before = screen.getByRole('region', { name: '종목 검색 결과' });
    fireEvent.click(within(before).getByRole('button', { name: '더 보기' }));
    before.scrollTop = 500;
    rerender(<StockSearchForm state={state({ searchQuery: 'ETF' })} onAdd={jest.fn()} />);
    const after = screen.getByRole('region', { name: '종목 검색 결과' });
    expect(after).not.toBe(before);
    expect(after.scrollTop).toBe(0);
    expect(within(after).getAllByRole('button', { name: /^검색 ETF/ })).toHaveLength(30);
  });
});
