'use client';

import { Loader2 } from 'lucide-react';
import type { StockSearchResult } from '@/types/asset';

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
  isLoadingPrice: boolean;
  isAddingHolding: boolean;
}

interface StockSearchFormProps {
  state: StockSearchState;
  onAdd: () => void;
}

export default function StockSearchForm({ state, onAdd }: StockSearchFormProps) {
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
    isLoadingPrice,
    isAddingHolding,
  } = state;

  return (
    <div className="p-4 bg-blue-100 border-b border-blue-200">
      <div className="space-y-3">
        <div className="relative">
          <label className="block text-sm font-medium text-slate-700 mb-1">종목 검색</label>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="종목명 입력"
            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
          {isSearching && (
            <Loader2 className="w-4 h-4 text-blue-500 absolute right-3 top-9 animate-spin" />
          )}

          {searchResults.length > 0 && !selectedStock && (
            <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {searchResults.map((stock) => (
                <button
                  key={stock.code}
                  type="button"
                  onClick={() => {
                    void selectStock(stock);
                  }}
                  className="w-full px-4 py-2.5 text-left hover:bg-slate-50 flex items-center justify-between"
                >
                  <span className="font-medium text-slate-800">{stock.name}</span>
                  <span className="text-xs text-slate-500">{stock.code}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedStock && (
          <>
            <div className="bg-white rounded-lg p-3 border border-blue-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-800">{selectedStock.name}</p>
                  <p className="text-xs text-slate-500">{selectedStock.code}</p>
                </div>
                {isLoadingPrice ? (
                  <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                ) : currentPrice ? (
                  <p className="font-semibold text-red-500">{currentPrice.toLocaleString()}원</p>
                ) : null}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">보유 수량</label>
              <input
                type="text"
                inputMode="numeric"
                value={quantity}
                onChange={(e) => setQuantityInput(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="0"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">평균 매입가 (선택)</label>
              <div className="relative">
                <input
                  type="text"
                  inputMode="numeric"
                  value={avgPrice ? parseInt(avgPrice, 10).toLocaleString() : ''}
                  onChange={(e) => setAvgPriceInput(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="0"
                  className="w-full px-4 py-2 pr-8 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">원</span>
              </div>
            </div>

            <button
              type="button"
              onClick={onAdd}
              disabled={!selectedStock || !quantity || isAddingHolding}
              className="w-full py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:bg-slate-300 font-medium"
            >
              {isAddingHolding ? '추가 중...' : '종목 추가'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
