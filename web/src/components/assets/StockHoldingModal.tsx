'use client';

import { useState, useEffect } from 'react';
import { Asset, StockHolding, StockSearchResult } from '@/types/asset';
import { addStockHolding, updateStockHolding, deleteStockHolding, subscribeToStockHoldings } from '@/lib/assetService';
import Portal from '@/components/Portal';
import { X, Plus, Trash2, Loader2 } from 'lucide-react';

interface StockHoldingModalProps {
  isOpen: boolean;
  onClose: () => void;
  asset: Asset | null;
}

export default function StockHoldingModal({ isOpen, onClose, asset }: StockHoldingModalProps) {
  const [holdings, setHoldings] = useState<StockHolding[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);

  // 종목 추가 폼 상태
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<StockSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedStock, setSelectedStock] = useState<StockSearchResult | null>(null);
  const [quantity, setQuantity] = useState('');
  const [avgPrice, setAvgPrice] = useState('');
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [isLoadingPrice, setIsLoadingPrice] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 보유 종목 구독
  useEffect(() => {
    if (!isOpen || !asset) {
      setHoldings([]);
      return;
    }

    setIsLoading(true);
    const unsubscribe = subscribeToStockHoldings(asset.id, (newHoldings) => {
      setHoldings(newHoldings);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [isOpen, asset]);

  // 종목 검색
  useEffect(() => {
    if (searchQuery.length < 1) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await fetch(`/api/stock/search?q=${encodeURIComponent(searchQuery)}`);
        const data = await response.json();
        setSearchResults(data.results || []);
      } catch (error) {
        console.error('종목 검색 오류:', error);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // 종목 선택
  const handleSelectStock = async (stock: StockSearchResult) => {
    setSelectedStock(stock);
    setSearchQuery(stock.name);
    setSearchResults([]);

    // 현재가 조회
    setIsLoadingPrice(true);
    try {
      const response = await fetch(`/api/stock/price?code=${stock.code}`);
      if (response.ok) {
        const data = await response.json();
        setCurrentPrice(data.price);
      }
    } catch (error) {
      console.error('시세 조회 오류:', error);
    } finally {
      setIsLoadingPrice(false);
    }
  };

  // 종목 추가
  const handleAddHolding = async () => {
    if (!asset || !selectedStock || !quantity || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await addStockHolding({
        assetId: asset.id,
        stockCode: selectedStock.code,
        stockName: selectedStock.name,
        quantity: parseInt(quantity, 10),
        avgPrice: avgPrice ? parseInt(avgPrice, 10) : undefined,
        currentPrice: currentPrice || undefined,
      });

      // 폼 초기화
      resetForm();
    } catch (error) {
      console.error('종목 추가 오류:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 종목 삭제
  const handleDeleteHolding = async (holdingId: string) => {
    if (!confirm('이 종목을 삭제하시겠습니까?')) return;

    try {
      await deleteStockHolding(holdingId);
    } catch (error) {
      console.error('종목 삭제 오류:', error);
    }
  };

  // 폼 초기화
  const resetForm = () => {
    setShowAddForm(false);
    setSearchQuery('');
    setSearchResults([]);
    setSelectedStock(null);
    setQuantity('');
    setAvgPrice('');
    setCurrentPrice(null);
  };

  // 평가금액 계산
  const calculateValue = (holding: StockHolding) => {
    const price = holding.currentPrice || holding.avgPrice || 0;
    return price * holding.quantity;
  };

  // 전체 평가금액
  const totalValue = holdings.reduce((sum, h) => sum + calculateValue(h), 0);

  if (!isOpen || !asset) return null;

  return (
    <Portal>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]">
        <div className="bg-white rounded-2xl p-6 m-4 max-w-md w-full shadow-xl max-h-[90vh] overflow-y-auto">
          {/* 헤더 */}
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

          {/* 총 평가금액 */}
          <div className="bg-slate-50 rounded-xl p-4 mb-4">
            <p className="text-sm text-slate-500">총 평가금액</p>
            <p className="text-2xl font-bold text-slate-800">
              {totalValue.toLocaleString()}
              <span className="text-base font-medium text-slate-400 ml-1">원</span>
            </p>
          </div>

          {/* 보유 종목 목록 */}
          <div className="space-y-2 mb-4">
            {isLoading ? (
              <div className="text-center py-8 text-slate-400">로딩 중...</div>
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
                      {calculateValue(holding).toLocaleString()}원
                    </p>
                    <button
                      onClick={() => handleDeleteHolding(holding.id)}
                      className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* 종목 추가 폼 */}
          {showAddForm ? (
            <div className="border-t border-slate-100 pt-4 space-y-3">
              <div className="relative">
                <label className="block text-sm font-medium text-slate-700 mb-1">종목 검색</label>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    if (selectedStock) {
                      setSelectedStock(null);
                      setCurrentPrice(null);
                    }
                  }}
                  placeholder="종목명 입력 (예: 삼성전자, TIGER)"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {isSearching && (
                  <Loader2 className="w-4 h-4 text-blue-500 absolute right-3 top-9 animate-spin" />
                )}

                {/* 검색 결과 */}
                {searchResults.length > 0 && !selectedStock && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {searchResults.map((stock) => (
                      <button
                        key={stock.code}
                        type="button"
                        onClick={() => handleSelectStock(stock)}
                        className="w-full px-4 py-2.5 text-left hover:bg-slate-50 flex items-center justify-between"
                      >
                        <span className="font-medium text-slate-800">{stock.name}</span>
                        <span className="text-xs text-slate-500">{stock.code}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 선택된 종목 */}
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

              {/* 보유 수량 */}
              {selectedStock && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">보유 수량</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value.replace(/[^0-9]/g, ''))}
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
                        onChange={(e) => setAvgPrice(e.target.value.replace(/[^0-9]/g, ''))}
                        placeholder="0"
                        className="w-full px-4 py-2 pr-8 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">원</span>
                    </div>
                  </div>

                  {/* 평가금액 미리보기 */}
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

              {/* 버튼 */}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={resetForm}
                  className="flex-1 py-2 px-4 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={handleAddHolding}
                  disabled={!selectedStock || !quantity || isSubmitting}
                  className="flex-1 py-2 px-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? '추가 중...' : '추가'}
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
