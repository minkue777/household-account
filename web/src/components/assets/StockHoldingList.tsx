'use client';

import { useState, useEffect } from 'react';
import { StockHolding } from '@/types/asset';
import { updateStockHolding, deleteStockHolding } from '@/lib/assetService';
import { RefreshCw } from 'lucide-react';
import { calculateHoldingValue } from '@/lib/utils/useStockHoldingManager';

interface DividendInfo {
  code: string;
  name: string;
  recentDividend: number | null;
  paymentDate: string | null;
  frequency: number | null;
  dividendYield: number | null;
}

interface StockHoldingListProps {
  holdings: StockHolding[];
  isLoading: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  assetId: string;
}

export default function StockHoldingList({
  holdings,
  isLoading,
  isRefreshing,
  onRefresh,
  assetId,
}: StockHoldingListProps) {
  // 보유 종목 수정 상태
  const [editingHolding, setEditingHolding] = useState<StockHolding | null>(null);
  const [editQuantity, setEditQuantity] = useState('');
  const [editAvgPrice, setEditAvgPrice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 배당금 정보 상태
  const [dividendInfoMap, setDividendInfoMap] = useState<Record<string, DividendInfo>>({});
  const [loadingDividends, setLoadingDividends] = useState<Set<string>>(new Set());

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
    if (holdings.length === 0) return;

    holdings.forEach(holding => {
      if (dividendInfoMap[holding.stockCode] || loadingDividends.has(holding.stockCode)) return;
      fetchDividendInfo(holding.stockCode);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdings]);

  // 보유 종목 수정 시작
  const handleEditHolding = (holding: StockHolding) => {
    setEditingHolding(holding);
    setEditQuantity(holding.quantity.toString());
    setEditAvgPrice(holding.avgPrice?.toString() || '');
  };

  // 보유 종목 수정 저장
  const handleSaveHolding = async () => {
    if (!editingHolding || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await updateStockHolding(editingHolding.id, assetId, {
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

  // 보유 종목 삭제
  const handleDeleteHolding = async (holdingId: string) => {
    try {
      await deleteStockHolding(holdingId, assetId);
    } catch (error) {
      console.error('종목 삭제 오류:', error);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-slate-500">보유 종목</h4>
        {holdings.length > 0 && (
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600 disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? '갱신중...' : '시세 갱신'}
          </button>
        )}
      </div>
      {isLoading ? (
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
              <HoldingItem
                key={holding.id}
                holding={holding}
                dividendInfo={dividendInfoMap[holding.stockCode]}
                isLoadingDividend={loadingDividends.has(holding.stockCode)}
                onEdit={handleEditHolding}
              />
            )
          ))}
        </div>
      )}
    </>
  );
}

interface HoldingItemProps {
  holding: StockHolding;
  dividendInfo: DividendInfo | undefined;
  isLoadingDividend: boolean;
  onEdit: (holding: StockHolding) => void;
}

function HoldingItem({ holding, dividendInfo, isLoadingDividend, onEdit }: HoldingItemProps) {
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
  // 예상 월 배당금 계산 (연간 배당금 / 12)
  const monthlyDividend = dividendInfo?.recentDividend && dividendInfo?.frequency
    ? Math.round((dividendInfo.recentDividend * dividendInfo.frequency * holding.quantity) / 12)
    : null;

  return (
    <div
      onClick={() => onEdit(holding)}
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
            {calculateHoldingValue(holding).toLocaleString()}원
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
}
