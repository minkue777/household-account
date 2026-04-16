'use client';

import { Loader2 } from 'lucide-react';
import type { StockPriceInfo, StockSearchResult } from '@/types/asset';

export interface StockSearchState {
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  searchResults: StockSearchResult[];
  isSearching: boolean;
  selectedStock: StockSearchResult | null;
  selectStock: (stock: StockSearchResult) => void;
  quantity: string;
  setQuantityInput: (value: string) => void;
  avgPrice: string;
  setAvgPriceInput: (value: string) => void;
  currentPrice: number | null;
  currentPriceInfo?: StockPriceInfo | null;
  isLoadingPrice: boolean;
  isAddingHolding: boolean;
}

interface StockSearchFormProps {
  state: StockSearchState;
  onAdd: () => void;
  theme?: 'blue' | 'amber';
  searchLabel?: string;
  searchPlaceholder?: string;
  addButtonLabel?: string;
}

const THEME_STYLES = {
  blue: {
    wrapper: 'border-b border-blue-200 bg-blue-100',
    loader: 'text-blue-500',
    selectedCard: 'border-blue-200',
    focus: 'focus:ring-blue-500',
    button: 'bg-blue-500 hover:bg-blue-600',
  },
  amber: {
    wrapper: 'border-b border-amber-200 bg-amber-100',
    loader: 'text-amber-500',
    selectedCard: 'border-amber-200',
    focus: 'focus:ring-amber-500',
    button: 'bg-amber-500 hover:bg-amber-600',
  },
} as const;

function getDisplayCode(stock: Pick<StockSearchResult, 'code' | 'market'>) {
  if (stock.market === 'US' && stock.code.startsWith('US:')) {
    return `미국 · ${stock.code.replace(/^US:/, '')}`;
  }

  return stock.code;
}

function formatUsdPrice(price?: number) {
  if (typeof price !== 'number' || !Number.isFinite(price)) {
    return null;
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(price);
}

export default function StockSearchForm({
  state,
  onAdd,
  theme = 'blue',
  searchLabel = '종목 검색',
  searchPlaceholder = '종목명 입력',
  addButtonLabel = '종목 추가',
}: StockSearchFormProps) {
  const {
    searchQuery,
    setSearchQuery,
    searchResults,
    isSearching,
    selectedStock,
    selectStock,
    quantity,
    setQuantityInput,
    avgPrice,
    setAvgPriceInput,
    currentPrice,
    currentPriceInfo,
    isLoadingPrice,
    isAddingHolding,
  } = state;

  const priceInfo = currentPriceInfo || null;
  const themeStyle = THEME_STYLES[theme];
  const averagePriceLabel =
    selectedStock?.market === 'US' ? '평균 매입가 (원 기준, 선택)' : '평균 매입가 (선택)';
  const usdPriceLabel = formatUsdPrice(priceInfo?.sourcePrice);

  return (
    <div className={`${themeStyle.wrapper} p-4`}>
      <div className="space-y-3">
        <div className="relative">
          <label className="mb-1 block text-sm font-medium text-slate-700">{searchLabel}</label>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className={`w-full rounded-lg border border-slate-300 bg-white px-4 py-2 focus:outline-none focus:ring-2 ${themeStyle.focus}`}
          />
          {isSearching && (
            <Loader2 className={`absolute right-3 top-9 h-4 w-4 animate-spin ${themeStyle.loader}`} />
          )}

          {searchResults.length > 0 && !selectedStock && (
            <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
              {searchResults.map((stock) => (
                <button
                  key={`${stock.market || 'KR'}-${stock.code}`}
                  type="button"
                  onClick={() => {
                    void selectStock(stock);
                  }}
                  className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-slate-50"
                >
                  <span className="font-medium text-slate-800">{stock.name}</span>
                  <span className="text-xs text-slate-500">{getDisplayCode(stock)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedStock && (
          <>
            <div className={`rounded-lg border bg-white p-3 ${themeStyle.selectedCard}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-slate-800">{selectedStock.name}</p>
                  <p className="text-xs text-slate-500">{getDisplayCode(selectedStock)}</p>
                </div>
                {isLoadingPrice ? (
                  <Loader2 className={`h-4 w-4 animate-spin ${themeStyle.loader}`} />
                ) : currentPrice ? (
                  <div className="text-right">
                    <p className="font-semibold text-red-500">{currentPrice.toLocaleString()}원</p>
                    {usdPriceLabel && (
                      <p className="text-xs text-slate-400">{usdPriceLabel}</p>
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">보유 수량</label>
              <input
                type="text"
                inputMode="numeric"
                value={quantity}
                onChange={(e) => setQuantityInput(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="0"
                className={`w-full rounded-lg border border-slate-300 bg-white px-4 py-2 focus:outline-none focus:ring-2 ${themeStyle.focus}`}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                {averagePriceLabel}
              </label>
              <div className="relative">
                <input
                  type="text"
                  inputMode="numeric"
                  value={avgPrice ? parseInt(avgPrice, 10).toLocaleString() : ''}
                  onChange={(e) => setAvgPriceInput(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="0"
                  className={`w-full rounded-lg border border-slate-300 bg-white px-4 py-2 pr-8 focus:outline-none focus:ring-2 ${themeStyle.focus}`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">원</span>
              </div>
            </div>

            <button
              type="button"
              onClick={onAdd}
              disabled={!selectedStock || !quantity || isAddingHolding}
              className={`w-full rounded-lg py-2.5 font-medium text-white transition-colors disabled:bg-slate-300 ${themeStyle.button}`}
            >
              {isAddingHolding ? '추가 중...' : addButtonLabel}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
