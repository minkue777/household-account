'use client';

import { Loader2 } from 'lucide-react';
import type { CryptoSearchResult } from '@/types/asset';

export interface CryptoSearchState {
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  searchResults: CryptoSearchResult[];
  isSearching: boolean;
  selectedCoin: CryptoSearchResult | null;
  selectCoin: (coin: CryptoSearchResult) => void;
  quantity: string;
  setQuantityInput: (value: string) => void;
  avgPrice: string;
  setAvgPriceInput: (value: string) => void;
  currentPrice: number | null;
  isLoadingPrice: boolean;
  isAddingHolding: boolean;
}

interface CryptoSearchFormProps {
  state: CryptoSearchState;
  onAdd: () => void;
}

export default function CryptoSearchForm({ state, onAdd }: CryptoSearchFormProps) {
  const {
    searchQuery,
    setSearchQuery,
    searchResults,
    isSearching,
    selectedCoin,
    selectCoin,
    quantity,
    setQuantityInput,
    avgPrice,
    setAvgPriceInput,
    currentPrice,
    isLoadingPrice,
    isAddingHolding,
  } = state;

  return (
    <div className="border-b border-orange-200 bg-orange-100 p-4">
      <div className="space-y-3">
        <div className="relative">
          <label className="mb-1 block text-sm font-medium text-slate-700">코인 검색</label>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="코인명 또는 KRW-BTC 입력"
            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          {isSearching && (
            <Loader2 className="absolute right-3 top-9 h-4 w-4 animate-spin text-orange-500" />
          )}

          {searchResults.length > 0 && !selectedCoin && (
            <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
              {searchResults.map((coin) => (
                <button
                  key={coin.code}
                  type="button"
                  onClick={() => {
                    void selectCoin(coin);
                  }}
                  className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-slate-50"
                >
                  <span className="font-medium text-slate-800">{coin.name}</span>
                  <span className="text-xs text-slate-500">{coin.code}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedCoin && (
          <>
            <div className="rounded-lg border border-orange-200 bg-white p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-800">{selectedCoin.name}</p>
                  <p className="text-xs text-slate-500">{selectedCoin.code}</p>
                </div>
                {isLoadingPrice ? (
                  <Loader2 className="h-4 w-4 animate-spin text-orange-500" />
                ) : currentPrice ? (
                  <p className="font-semibold text-red-500">{currentPrice.toLocaleString()}원</p>
                ) : null}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">보유 수량</label>
              <input
                type="text"
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantityInput(e.target.value)}
                placeholder="0"
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">평균 매수가 (선택)</label>
              <div className="relative">
                <input
                  type="text"
                  inputMode="numeric"
                  value={avgPrice ? parseInt(avgPrice, 10).toLocaleString() : ''}
                  onChange={(e) => setAvgPriceInput(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="0"
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">원</span>
              </div>
            </div>

            <button
              type="button"
              onClick={onAdd}
              disabled={!selectedCoin || !quantity || isAddingHolding}
              className="w-full rounded-lg bg-orange-500 py-2.5 font-medium text-white transition-colors hover:bg-orange-600 disabled:bg-slate-300"
            >
              {isAddingHolding ? '추가 중...' : '코인 추가'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
