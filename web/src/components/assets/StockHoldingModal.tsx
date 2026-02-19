'use client';

import { useEffect, useState } from 'react';
import { Asset } from '@/types/asset';
import { Portal } from '@/components/common';
import { X, Plus, Trash2, Loader2 } from 'lucide-react';
import { calculateHoldingValue, useStockHoldingManager } from '@/lib/utils/useStockHoldingManager';

interface StockHoldingModalProps {
  isOpen: boolean;
  onClose: () => void;
  asset: Asset | null;
}

export default function StockHoldingModal({ isOpen, onClose, asset }: StockHoldingModalProps) {
  const [showAddForm, setShowAddForm] = useState(false);

  const {
    holdings,
    isLoadingHoldings,
    totalHoldingValue,
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
    addHolding,
    deleteHolding,
    resetStockForm,
  } = useStockHoldingManager({ isOpen, asset });

  useEffect(() => {
    if (!isOpen) {
      setShowAddForm(false);
    }
  }, [isOpen]);

  const handleAddHolding = async () => {
    const added = await addHolding();
    if (added) {
      setShowAddForm(false);
    }
  };

  const handleDeleteHolding = async (holdingId: string) => {
    if (!confirm('이 종목을 삭제하시겠습니까?')) {
      return;
    }

    await deleteHolding(holdingId);
  };

  const handleCancelAddForm = () => {
    setShowAddForm(false);
    resetStockForm();
  };

  if (!isOpen || !asset) {
    return null;
  }

  return (
    <Portal>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]">
        <div className="bg-white rounded-2xl p-6 m-4 max-w-md w-full shadow-xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-slate-800">{asset.name}</h2>
              <p className="text-sm text-slate-500">보유 종목 관리</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>

          <div className="bg-slate-50 rounded-xl p-4 mb-4">
            <p className="text-sm text-slate-500">총 평가금액</p>
            <p className="text-2xl font-bold text-slate-800">
              {totalHoldingValue.toLocaleString()}
              <span className="text-base font-medium text-slate-400 ml-1">원</span>
            </p>
          </div>

          <div className="space-y-2 mb-4">
            {isLoadingHoldings ? (
              <div className="text-center py-8 text-slate-400">로딩 중..</div>
            ) : holdings.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                보유 종목이 없습니다
              </div>
            ) : (
              holdings.map((holding) => (
                <div
                  key={holding.id}
                  className="flex items-center justify-between p-3 bg-slate-50 rounded-xl"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-800 truncate">{holding.stockName}</p>
                    <p className="text-xs text-slate-500">
                      {holding.quantity.toLocaleString()}주
                      {holding.currentPrice && ` · ${holding.currentPrice.toLocaleString()}원`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-slate-800">
                      {calculateHoldingValue(holding).toLocaleString()}원
                    </p>
                    <button
                      onClick={() => {
                        void handleDeleteHolding(holding.id);
                      }}
                      className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {showAddForm ? (
            <div className="border-t border-slate-100 pt-4 space-y-3">
              <div className="relative">
                <label className="block text-sm font-medium text-slate-700 mb-1">종목 검색</label>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="종목명 입력 (예: 삼성전자, TIGER)"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                <div className="bg-blue-50 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-slate-800">{selectedStock.name}</p>
                      <p className="text-xs text-slate-500">{selectedStock.code}</p>
                    </div>
                    {isLoadingPrice ? (
                      <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                    ) : currentPrice ? (
                      <p className="font-semibold text-blue-600">{currentPrice.toLocaleString()}원</p>
                    ) : null}
                  </div>
                </div>
              )}

              {selectedStock && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">보유 수량</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={quantity}
                      onChange={(e) => setQuantityInput(e.target.value)}
                      placeholder="0"
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">평균 매입가 (선택)</label>
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={avgPrice ? parseInt(avgPrice, 10).toLocaleString() : ''}
                        onChange={(e) => setAvgPriceInput(e.target.value)}
                        placeholder="0"
                        className="w-full px-4 py-2 pr-8 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">원</span>
                    </div>
                  </div>

                  {quantity && parseInt(quantity, 10) > 0 && currentPrice && (
                    <div className="bg-slate-50 rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-600">예상 평가금액</span>
                        <span className="font-semibold text-slate-800">
                          {(currentPrice * parseInt(quantity, 10)).toLocaleString()}원
                        </span>
                      </div>
                    </div>
                  )}
                </>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleCancelAddForm}
                  className="flex-1 py-2 px-4 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={() => {
                    void handleAddHolding();
                  }}
                  disabled={!selectedStock || !quantity || isAddingHolding}
                  className="flex-1 py-2 px-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
                >
                  {isAddingHolding ? '추가 중..' : '추가'}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowAddForm(true)}
              className="w-full py-3 border-2 border-dashed border-slate-200 rounded-xl text-slate-500 hover:border-blue-300 hover:text-blue-500 transition-colors flex items-center justify-center gap-2"
            >
              <Plus className="w-5 h-5" />
              종목 추가
            </button>
          )}
        </div>
      </div>
    </Portal>
  );
}
