'use client';

import { useState, useEffect } from 'react';
import { Asset, AssetHistoryEntry, ASSET_TYPE_CONFIG, StockHolding, StockSearchResult } from '@/types/asset';
import { subscribeToAssetHistory, updateBalanceWithHistory, deleteHistoryEntry, subscribeToStockHoldings, addStockHolding, updateStockHolding, deleteStockHolding, updateAsset } from '@/lib/assetService';
import Portal from '@/components/Portal';
import { X, Plus, Trash2, Edit2, TrendingUp, TrendingDown, Banknote, Home, BarChart3, Coins, Loader2, RefreshCw } from 'lucide-react';

interface GoldPriceData {
  buyPricePerDon: number;
  sellPricePerDon: number;
  timestamp: string;
  estimated?: boolean;
}

interface DividendInfo {
  code: string;
  name: string;
  recentDividend: number | null;
  paymentDate: string | null;
  frequency: number | null;
  dividendYield: number | null;
}

interface AssetHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  asset: Asset | null;
  onEditAsset: () => void;
  onViewChart: () => void;
}

const ICONS: Record<string, React.ReactNode> = {
  savings: <Banknote className="w-5 h-5" />,
  stock: <BarChart3 className="w-5 h-5" />,
  property: <Home className="w-5 h-5" />,
  gold: <Coins className="w-5 h-5" />,
};

export default function AssetHistoryModal({
  isOpen,
  onClose,
  asset,
  onEditAsset,
  onViewChart,
}: AssetHistoryModalProps) {
  const [history, setHistory] = useState<AssetHistoryEntry[]>([]);
  const [showUpdateForm, setShowUpdateForm] = useState(false);
  const [newBalance, setNewBalance] = useState('');
  const [updateDate, setUpdateDate] = useState(new Date().toISOString().split('T')[0]);
  const [updateMemo, setUpdateMemo] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 주식 관련 상태
  const [holdings, setHoldings] = useState<StockHolding[]>([]);
  const [isLoadingHoldings, setIsLoadingHoldings] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<StockSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedStock, setSelectedStock] = useState<StockSearchResult | null>(null);
  const [quantity, setQuantity] = useState('');
  const [avgPrice, setAvgPrice] = useState('');
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [isLoadingPrice, setIsLoadingPrice] = useState(false);

  // 보유 종목 수정 상태
  const [editingHolding, setEditingHolding] = useState<StockHolding | null>(null);
  const [editQuantity, setEditQuantity] = useState('');
  const [editAvgPrice, setEditAvgPrice] = useState('');

  // 배당금 정보 상태
  const [dividendInfoMap, setDividendInfoMap] = useState<Record<string, DividendInfo>>({});
  const [loadingDividends, setLoadingDividends] = useState<Set<string>>(new Set());

  // 금 관련 상태
  const [goldQuantity, setGoldQuantity] = useState('');
  const [goldPrice, setGoldPrice] = useState<GoldPriceData | null>(null);
  const [isLoadingGoldPrice, setIsLoadingGoldPrice] = useState(false);

  // 이력 구독 (주식/금 타입이 아닐 때)
  useEffect(() => {
    if (!asset || asset.type === 'stock' || asset.type === 'gold') return;

    const unsubscribe = subscribeToAssetHistory(asset.id, setHistory);
    return () => unsubscribe();
  }, [asset]);

  // 주식 보유 종목 구독
  useEffect(() => {
    if (!isOpen || !asset || asset.type !== 'stock') {
      setHoldings([]);
      return;
    }

    // 모달 열릴 때 검색 폼 초기화
    setSearchQuery('');
    setSearchResults([]);
    setSelectedStock(null);
    setQuantity('');
    setAvgPrice('');
    setCurrentPrice(null);

    setIsLoadingHoldings(true);
    const unsubscribe = subscribeToStockHoldings(asset.id, (newHoldings) => {
      setHoldings(newHoldings);
      setIsLoadingHoldings(false);
    });

    return () => unsubscribe();
  }, [isOpen, asset]);

  // 금 시세 및 보유량 로드
  useEffect(() => {
    if (!isOpen || !asset || asset.type !== 'gold') return;

    // memo에서 돈 단위 추출
    const match = asset.memo?.match(/(\d+(?:\.\d+)?)\s*돈/);
    if (match) {
      setGoldQuantity(match[1]);
    } else {
      setGoldQuantity('');
    }
    fetchGoldPrice();
  }, [isOpen, asset]);

  // 배당금 정보 조회
  const fetchDividendInfo = async (stockCode: string) => {
    if (dividendInfoMap[stockCode] || loadingDividends.has(stockCode)) return;

    setLoadingDividends(prev => new Set(prev).add(stockCode));
    try {
      const response = await fetch(`/api/stock/dividend?code=${stockCode}`);
      if (response.ok) {
        const data = await response.json();
        setDividendInfoMap(prev => ({ ...prev, [stockCode]: data }));
      }
    } catch (error) {
      console.error('배당금 조회 오류:', error);
    } finally {
      setLoadingDividends(prev => {
        const next = new Set(prev);
        next.delete(stockCode);
        return next;
      });
    }
  };

  // 보유 종목이 변경되면 배당금 정보 조회
  useEffect(() => {
    if (!isOpen || holdings.length === 0) return;

    holdings.forEach(holding => {
      // 이미 조회했거나 로딩중이면 스킵
      if (dividendInfoMap[holding.stockCode] || loadingDividends.has(holding.stockCode)) return;
      fetchDividendInfo(holding.stockCode);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdings, isOpen]);

  // 금 시세 조회
  const fetchGoldPrice = async () => {
    setIsLoadingGoldPrice(true);
    try {
      const response = await fetch('/api/gold/price');
      if (response.ok) {
        const data = await response.json();
        setGoldPrice(data);
      }
    } catch (error) {
      console.error('금 시세 조회 오류:', error);
    } finally {
      setIsLoadingGoldPrice(false);
    }
  };

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

  // 잔액 업데이트 폼 초기화
  useEffect(() => {
    if (showUpdateForm && asset) {
      setNewBalance(asset.currentBalance.toString());
      setUpdateDate(new Date().toISOString().split('T')[0]);
      setUpdateMemo('');
    }
  }, [showUpdateForm, asset]);

  const handleUpdateBalance = async () => {
    if (!asset || isSubmitting) return;

    const balanceNum = parseInt(newBalance, 10);
    if (isNaN(balanceNum)) return;

    setIsSubmitting(true);
    try {
      await updateBalanceWithHistory(asset.id, balanceNum, updateDate, updateMemo.trim());
      setShowUpdateForm(false);
    } catch (error) {
      console.error('잔액 업데이트 오류:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteHistory = async (historyId: string) => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    try {
      await deleteHistoryEntry(historyId);
    } catch (error) {
      console.error('이력 삭제 오류:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 종목 선택
  const handleSelectStock = async (stock: StockSearchResult) => {
    setSelectedStock(stock);
    setSearchQuery(stock.name);
    setSearchResults([]);

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
      resetStockForm();
    } catch (error) {
      console.error('종목 추가 오류:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 종목 삭제
  const handleDeleteHolding = async (holdingId: string) => {
    if (!asset) return;
    try {
      await deleteStockHolding(holdingId, asset.id);
    } catch (error) {
      console.error('종목 삭제 오류:', error);
    }
  };

  // 보유 종목 수정 시작
  const handleEditHolding = (holding: StockHolding) => {
    setEditingHolding(holding);
    setEditQuantity(holding.quantity.toString());
    setEditAvgPrice(holding.avgPrice?.toString() || '');
  };

  // 보유 종목 수정 저장
  const handleSaveHolding = async () => {
    if (!asset || !editingHolding || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await updateStockHolding(editingHolding.id, asset.id, {
        quantity: parseInt(editQuantity, 10),
        avgPrice: editAvgPrice ? parseInt(editAvgPrice, 10) : undefined,
      });
      setEditingHolding(null);
    } catch (error) {
      console.error('종목 수정 오류:', error);
      alert('종목 수정에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 보유 종목 수정 취소
  const handleCancelEditHolding = () => {
    setEditingHolding(null);
    setEditQuantity('');
    setEditAvgPrice('');
  };

  // 주식 폼 초기화
  const resetStockForm = () => {
    setSearchQuery('');
    setSearchResults([]);
    setSelectedStock(null);
    setQuantity('');
    setAvgPrice('');
    setCurrentPrice(null);
  };

  // 금 저장
  const handleSaveGold = async () => {
    if (!asset || !goldQuantity || !goldPrice || isSubmitting) return;

    setIsSubmitting(true);
    try {
      // 팔 때 가격으로 평가금액 계산
      const totalValue = Math.round(goldPrice.sellPricePerDon * parseFloat(goldQuantity));
      await updateAsset(asset.id, {
        currentBalance: totalValue,
        memo: `${goldQuantity}돈`,
      });
      onClose();
    } catch (error) {
      console.error('금 보유량 저장 오류:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 평가금액 계산
  const calculateStockValue = (holding: StockHolding) => {
    const price = holding.currentPrice || holding.avgPrice || 0;
    return price * holding.quantity;
  };

  if (!isOpen || !asset) return null;

  const config = ASSET_TYPE_CONFIG[asset.type];
  const isStock = asset.type === 'stock';
  const isGold = asset.type === 'gold';
  const totalStockValue = holdings.reduce((sum, h) => sum + calculateStockValue(h), 0);
  const goldTotalValue = goldPrice && goldQuantity
    ? Math.round(goldPrice.sellPricePerDon * parseFloat(goldQuantity))
    : 0;

  // 주식 계좌 수익률 계산
  const investmentBase = asset.initialInvestment || asset.costBasis || 0;
  const stockProfitLoss = isStock && investmentBase > 0 ? asset.currentBalance - investmentBase : 0;
  const stockProfitLossRate = isStock && investmentBase > 0 ? (stockProfitLoss / investmentBase) * 100 : 0;
  const showStockProfitLoss = isStock && investmentBase > 0;
  const isStockProfit = stockProfitLoss >= 0;

  return (
    <Portal>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]">
        <div className="bg-white rounded-2xl m-4 max-w-lg w-full shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
          {/* 헤더 */}
          <div className="p-4 border-b border-slate-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: `${asset.color || config.color}15`, color: asset.color || config.color }}
                >
                  {ICONS[asset.type]}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-800">{asset.name}</h3>
                  <p className="text-sm text-slate-500">
                    {asset.subType && `${asset.subType} · `}
                    {isStock ? '평가금액 ' : ''}{asset.currentBalance.toLocaleString()}원
                  </p>
                  {showStockProfitLoss && (
                    <p className={`text-sm font-medium ${isStockProfit ? 'text-red-500' : 'text-blue-500'}`}>
                      {isStockProfit ? '+' : ''}{stockProfitLossRate.toFixed(2)}%
                      <span className="ml-1">
                        ({isStockProfit ? '+' : ''}{stockProfitLoss.toLocaleString()}원)
                      </span>
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={onEditAsset}
                  className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-500"
                  title="수정"
                >
                  <Edit2 className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>
            </div>

            {/* 버튼들 - 주식/금이 아닐 때만 표시 */}
            {!isStock && !isGold && (
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowUpdateForm(true)}
                  className="px-4 py-2.5 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-colors flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  잔액 업데이트
                </button>
                <button
                  type="button"
                  onClick={onViewChart}
                  className="px-4 py-2.5 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200 transition-colors"
                >
                  차트
                </button>
              </div>
            )}

          </div>

          {/* 잔액 업데이트 폼 (예적금/부동산) */}
          {!isStock && !isGold && showUpdateForm && (
            <div className="p-4 bg-blue-50 border-b border-blue-100">
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    새 잔액
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={newBalance ? parseInt(newBalance, 10).toLocaleString() : ''}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^0-9]/g, '');
                        setNewBalance(raw);
                      }}
                      className="w-full px-4 py-2 pr-8 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                      원
                    </span>
                  </div>
                  {newBalance && asset && (
                    <p
                      className={`text-sm mt-1 ${
                        parseInt(newBalance, 10) > asset.currentBalance
                          ? 'text-green-500'
                          : parseInt(newBalance, 10) < asset.currentBalance
                          ? 'text-red-500'
                          : 'text-slate-400'
                      }`}
                    >
                      {parseInt(newBalance, 10) > asset.currentBalance
                        ? `+${(parseInt(newBalance, 10) - asset.currentBalance).toLocaleString()}`
                        : parseInt(newBalance, 10) < asset.currentBalance
                        ? (parseInt(newBalance, 10) - asset.currentBalance).toLocaleString()
                        : '변동 없음'}
                      원
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      날짜
                    </label>
                    <input
                      type="date"
                      value={updateDate}
                      onChange={(e) => setUpdateDate(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      메모
                    </label>
                    <input
                      type="text"
                      value={updateMemo}
                      onChange={(e) => setUpdateMemo(e.target.value)}
                      placeholder="메모 (선택)"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowUpdateForm(false)}
                    className="flex-1 py-2 border border-slate-300 rounded-lg text-slate-600 hover:bg-white transition-colors"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={handleUpdateBalance}
                    disabled={!newBalance || isSubmitting}
                    className="flex-1 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:bg-slate-300"
                  >
                    {isSubmitting ? '저장 중...' : '저장'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 주식: 종목 검색 폼 (콘텐츠 영역 밖) */}
          {isStock && (
            <div className="p-4 bg-blue-100 border-b border-blue-200">
              <div className="space-y-3">
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
                        onChange={(e) => setQuantity(e.target.value.replace(/[^0-9]/g, ''))}
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
                          onChange={(e) => setAvgPrice(e.target.value.replace(/[^0-9]/g, ''))}
                          placeholder="0"
                          className="w-full px-4 py-2 pr-8 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">원</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleAddHolding}
                      disabled={!selectedStock || !quantity || isSubmitting}
                      className="w-full py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:bg-slate-300 font-medium"
                    >
                      {isSubmitting ? '추가 중...' : '종목 추가'}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* 콘텐츠 영역 */}
          <div className="flex-1 overflow-y-auto p-4">
            {isGold ? (
              // 금: 시세 및 보유량
              <div className="space-y-4">
                {/* 금 시세 */}
                <div className="bg-amber-50 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-amber-700">현재 금 시세 (1돈)</span>
                    <button
                      type="button"
                      onClick={fetchGoldPrice}
                      disabled={isLoadingGoldPrice}
                      className="p-1 text-amber-600 hover:bg-amber-100 rounded transition-colors"
                    >
                      <RefreshCw className={`w-4 h-4 ${isLoadingGoldPrice ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                  {isLoadingGoldPrice ? (
                    <div className="flex items-center gap-2 text-amber-600">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>시세 조회 중...</span>
                    </div>
                  ) : goldPrice ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-white rounded-lg p-3">
                        <p className="text-xs text-slate-500 mb-1">살 때</p>
                        <p className="text-lg font-bold text-red-500">
                          {goldPrice.buyPricePerDon.toLocaleString()}
                          <span className="text-sm font-normal text-slate-400 ml-1">원</span>
                        </p>
                      </div>
                      <div className="bg-white rounded-lg p-3">
                        <p className="text-xs text-slate-500 mb-1">팔 때</p>
                        <p className="text-lg font-bold text-blue-500">
                          {goldPrice.sellPricePerDon.toLocaleString()}
                          <span className="text-sm font-normal text-slate-400 ml-1">원</span>
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-amber-600">시세를 불러올 수 없습니다</p>
                  )}
                </div>

                {/* 보유량 입력 */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    보유량
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={goldQuantity}
                      onChange={(e) => setGoldQuantity(e.target.value.replace(/[^0-9.]/g, ''))}
                      placeholder="0"
                      className="w-full px-4 py-3 pr-12 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 text-lg"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-medium">
                      돈
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    1돈 = 3.75g (순금 24K 기준)
                  </p>
                </div>

                {/* 평가금액 */}
                {goldQuantity && parseFloat(goldQuantity) > 0 && goldPrice && (
                  <div className="bg-slate-50 rounded-xl p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600">평가금액 (팔 때 기준)</span>
                      <span className="text-xl font-bold text-slate-800">
                        {goldTotalValue.toLocaleString()}원
                      </span>
                    </div>
                  </div>
                )}

                {/* 저장 버튼 */}
                <button
                  type="button"
                  onClick={handleSaveGold}
                  disabled={!goldQuantity || !goldPrice || isSubmitting}
                  className="w-full py-3 bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed font-medium"
                >
                  {isSubmitting ? '저장 중...' : '저장'}
                </button>
              </div>
            ) : isStock ? (
              // 주식: 보유 종목 목록
              <>
                  <h4 className="text-sm font-medium text-slate-500 mb-3">보유 종목</h4>
                  {isLoadingHoldings ? (
                    <div className="text-center py-8 text-slate-400">로딩 중...</div>
                  ) : holdings.length === 0 ? (
                    <div className="text-center py-8 text-slate-400">
                      보유 종목이 없습니다
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {holdings.map((holding) => (
                        editingHolding?.id === holding.id ? (
                          // 수정 모드
                          <div key={holding.id} className="p-3 bg-blue-50 rounded-xl space-y-3">
                            <div className="flex items-center justify-between">
                              <p className="font-medium text-slate-800">{holding.stockName}</p>
                              {holding.currentPrice && (
                                <p className="text-sm font-semibold text-red-500">
                                  {holding.currentPrice.toLocaleString()}원
                                </p>
                              )}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-xs text-slate-500 mb-1">수량</label>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={editQuantity}
                                  onChange={(e) => setEditQuantity(e.target.value.replace(/[^0-9]/g, ''))}
                                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-slate-500 mb-1">평균 매입가</label>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={editAvgPrice ? parseInt(editAvgPrice, 10).toLocaleString() : ''}
                                  onChange={(e) => setEditAvgPrice(e.target.value.replace(/[^0-9]/g, ''))}
                                  placeholder="0"
                                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                                />
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  if (confirm(`${holding.stockName}을(를) 삭제하시겠습니까?`)) {
                                    handleDeleteHolding(holding.id);
                                    setEditingHolding(null);
                                  }
                                }}
                                className="py-2 px-3 border border-red-300 text-red-500 rounded-lg text-sm hover:bg-red-50"
                              >
                                삭제
                              </button>
                              <button
                                type="button"
                                onClick={handleCancelEditHolding}
                                className="flex-1 py-2 border border-slate-300 rounded-lg text-slate-600 text-sm hover:bg-white"
                              >
                                취소
                              </button>
                              <button
                                type="button"
                                onClick={handleSaveHolding}
                                disabled={!editQuantity || isSubmitting}
                                className="flex-1 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 disabled:bg-slate-300"
                              >
                                {isSubmitting ? '저장 중...' : '저장'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          // 일반 모드
                          (() => {
                            const hasAvgPrice = holding.avgPrice && holding.avgPrice > 0;
                            const hasCurrentPrice = holding.currentPrice && holding.currentPrice > 0;
                            const holdingProfitLoss = hasAvgPrice && hasCurrentPrice
                              ? (holding.currentPrice! - holding.avgPrice!) * holding.quantity
                              : 0;
                            const holdingProfitRate = hasAvgPrice && hasCurrentPrice
                              ? ((holding.currentPrice! - holding.avgPrice!) / holding.avgPrice!) * 100
                              : 0;
                            const showHoldingProfit = hasAvgPrice && hasCurrentPrice;
                            const isHoldingProfit = holdingProfitLoss >= 0;
                            const dividendInfo = dividendInfoMap[holding.stockCode];
                            const isLoadingDividend = loadingDividends.has(holding.stockCode);
                            // 예상 월 배당금 계산 (연간 배당금 / 12)
                            const monthlyDividend = dividendInfo?.recentDividend && dividendInfo?.frequency
                              ? Math.round((dividendInfo.recentDividend * dividendInfo.frequency * holding.quantity) / 12)
                              : null;

                            return (
                              <div
                                key={holding.id}
                                onClick={() => handleEditHolding(holding)}
                                className="p-3 bg-slate-50 rounded-xl cursor-pointer hover:bg-slate-100 transition-colors"
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex-1 min-w-0 mr-4">
                                    <p className="font-medium text-slate-800 truncate">{holding.stockName}</p>
                                    <p className="text-xs text-slate-500">
                                      {holding.quantity.toLocaleString()}주
                                      {holding.avgPrice && ` · 평단 ${holding.avgPrice.toLocaleString()}원`}
                                    </p>
                                  </div>
                                  <div className="text-right flex-shrink-0">
                                    <p className="font-semibold text-slate-800">
                                      {calculateStockValue(holding).toLocaleString()}원
                                    </p>
                                    {showHoldingProfit && (
                                      <p className={`text-xs ${isHoldingProfit ? 'text-red-500' : 'text-blue-500'}`}>
                                        {isHoldingProfit ? '+' : ''}{holdingProfitRate.toFixed(2)}%
                                        <span className="ml-1">
                                          ({isHoldingProfit ? '+' : ''}{holdingProfitLoss.toLocaleString()})
                                        </span>
                                      </p>
                                    )}
                                  </div>
                                </div>
                                {/* 배당금 정보 */}
                                {isLoadingDividend ? (
                                  <div className="mt-2 pt-2 border-t border-slate-200">
                                    <p className="text-xs text-slate-400">배당 정보 로딩중...</p>
                                  </div>
                                ) : dividendInfo && dividendInfo.recentDividend ? (
                                  <div className="mt-2 pt-2 border-t border-slate-200">
                                    <div className="flex items-center justify-between text-xs">
                                      <span className="text-slate-500">
                                        분배금 {dividendInfo.recentDividend.toLocaleString()}원
                                        {dividendInfo.frequency && ` · 연 ${dividendInfo.frequency}회`}
                                      </span>
                                      {monthlyDividend && (
                                        <span className="text-emerald-600 font-medium">
                                          월 ~{monthlyDividend.toLocaleString()}원
                                        </span>
                                      )}
                                    </div>
                                    {dividendInfo.paymentDate && (
                                      <p className="text-xs text-slate-400 mt-0.5">
                                        최근 지급일: {dividendInfo.paymentDate}
                                      </p>
                                    )}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })()
                        )
                      ))}
                    </div>
                  )}
              </>
            ) : (
              // 기타: 변동 이력
              <>
                <h4 className="text-sm font-medium text-slate-500 mb-3">변동 이력</h4>
                {history.length === 0 ? (
                  <div className="text-center py-8 text-slate-400">
                    아직 이력이 없습니다.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {history.map((entry) => (
                      <div
                        key={entry.id}
                        className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl"
                      >
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                            entry.changeAmount > 0
                              ? 'bg-green-100 text-green-500'
                              : entry.changeAmount < 0
                              ? 'bg-red-100 text-red-500'
                              : 'bg-slate-100 text-slate-400'
                          }`}
                        >
                          {entry.changeAmount > 0 ? (
                            <TrendingUp className="w-4 h-4" />
                          ) : entry.changeAmount < 0 ? (
                            <TrendingDown className="w-4 h-4" />
                          ) : (
                            <span className="text-xs">-</span>
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-800">
                              {entry.balance.toLocaleString()}원
                            </span>
                            <span
                              className={`text-sm ${
                                entry.changeAmount > 0
                                  ? 'text-green-500'
                                  : entry.changeAmount < 0
                                  ? 'text-red-500'
                                  : 'text-slate-400'
                              }`}
                            >
                              ({entry.changeAmount > 0 ? '+' : ''}
                              {entry.changeAmount.toLocaleString()})
                            </span>
                          </div>
                          <div className="text-xs text-slate-500">
                            {entry.date}
                            {entry.memo && ` · ${entry.memo}`}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleDeleteHistory(entry.id)}
                          className="p-1.5 hover:bg-red-100 rounded-lg transition-colors text-slate-400 hover:text-red-500"
                          disabled={isSubmitting}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
