'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { CryptoHolding } from '@/types/asset';
import { deleteCryptoHolding, updateCryptoHolding } from '@/lib/assetService';
import { calculateCryptoHoldingValue } from '@/lib/utils/useCryptoHoldingManager';

interface CryptoHoldingListProps {
  holdings: CryptoHolding[];
  isLoading: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  assetId: string;
}

function sanitizeDecimalInput(rawValue: string) {
  const cleaned = rawValue.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');

  if (firstDot === -1) {
    return cleaned;
  }

  return `${cleaned.slice(0, firstDot + 1)}${cleaned.slice(firstDot + 1).replace(/\./g, '')}`;
}

function formatQuantity(quantity: number) {
  return quantity.toLocaleString('ko-KR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
  });
}

export default function CryptoHoldingList({
  holdings,
  isLoading,
  isRefreshing,
  onRefresh,
  assetId,
}: CryptoHoldingListProps) {
  const [editingHolding, setEditingHolding] = useState<CryptoHolding | null>(null);
  const [editQuantity, setEditQuantity] = useState('');
  const [editAvgPrice, setEditAvgPrice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleEditHolding = (holding: CryptoHolding) => {
    setEditingHolding(holding);
    setEditQuantity(holding.quantity.toString());
    setEditAvgPrice(holding.avgPrice?.toString() || '');
  };

  const handleSaveHolding = async () => {
    if (!editingHolding || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      await updateCryptoHolding(editingHolding.id, assetId, {
        quantity: parseFloat(editQuantity),
        avgPrice: editAvgPrice ? parseInt(editAvgPrice, 10) : undefined,
      });
      setEditingHolding(null);
    } catch (error) {
      console.error('코인 수정 오류:', error);
      alert('코인 수정에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteHolding = async (holdingId: string) => {
    try {
      await deleteCryptoHolding(holdingId, assetId);
    } catch (error) {
      console.error('코인 삭제 오류:', error);
    }
  };

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-medium text-slate-500">보유 코인</h4>
        {holdings.length > 0 && (
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1 text-xs text-orange-500 hover:text-orange-600 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? '갱신 중...' : '시세 갱신'}
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-slate-400">로딩 중...</div>
      ) : holdings.length === 0 ? (
        <div className="py-8 text-center text-slate-400">보유 코인이 없습니다</div>
      ) : (
        <div className="space-y-2">
          {holdings.map((holding) =>
            editingHolding?.id === holding.id ? (
              <div
                key={holding.id}
                onClick={() => setEditingHolding(null)}
                className="space-y-3 rounded-xl bg-orange-50 p-3"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-800">{holding.coinName}</p>
                    <p className="text-xs text-slate-500">{holding.marketCode}</p>
                  </div>
                  {holding.currentPrice && (
                    <p className="text-sm font-semibold text-red-500">
                      {holding.currentPrice.toLocaleString()}원
                    </p>
                  )}
                </div>

                <div
                  className="grid grid-cols-2 gap-2"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">수량</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={editQuantity}
                      onChange={(e) => setEditQuantity(sanitizeDecimalInput(e.target.value))}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">평단 매수가</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={editAvgPrice ? parseInt(editAvgPrice, 10).toLocaleString() : ''}
                      onChange={(e) => setEditAvgPrice(e.target.value.replace(/[^0-9]/g, ''))}
                      placeholder="0"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <div className="flex gap-2" onClick={(event) => event.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`${holding.coinName}을 삭제하시겠습니까?`)) {
                        void handleDeleteHolding(holding.id);
                        setEditingHolding(null);
                      }
                    }}
                    className="flex-1 rounded-lg border border-red-300 px-3 py-2 text-sm text-red-500 hover:bg-red-50"
                  >
                    삭제
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleSaveHolding();
                    }}
                    disabled={!editQuantity || isSubmitting}
                    className="flex-1 rounded-lg bg-orange-500 py-2 text-sm text-white hover:bg-orange-600 disabled:bg-slate-300"
                  >
                    {isSubmitting ? '저장 중...' : '저장'}
                  </button>
                </div>
              </div>
            ) : (
              <CryptoHoldingItem key={holding.id} holding={holding} onEdit={handleEditHolding} />
            )
          )}
        </div>
      )}
    </>
  );
}

interface CryptoHoldingItemProps {
  holding: CryptoHolding;
  onEdit: (holding: CryptoHolding) => void;
}

function CryptoHoldingItem({ holding, onEdit }: CryptoHoldingItemProps) {
  const hasAvgPrice = holding.avgPrice && holding.avgPrice > 0;
  const hasCurrentPrice = holding.currentPrice && holding.currentPrice > 0;
  const holdingProfitLoss =
    hasAvgPrice && hasCurrentPrice ? (holding.currentPrice! - holding.avgPrice!) * holding.quantity : 0;
  const holdingProfitRate =
    hasAvgPrice && hasCurrentPrice ? ((holding.currentPrice! - holding.avgPrice!) / holding.avgPrice!) * 100 : 0;
  const showHoldingProfit = hasAvgPrice && hasCurrentPrice;
  const isHoldingProfit = holdingProfitLoss >= 0;

  return (
    <div
      onClick={() => onEdit(holding)}
      className="cursor-pointer rounded-xl bg-slate-50 p-3 transition-colors hover:bg-slate-100"
    >
      <div className="flex items-center justify-between">
        <div className="mr-4 min-w-0 flex-1">
          <p className="truncate font-medium text-slate-800">{holding.coinName}</p>
          <p className="mt-0.5 text-[11px] text-slate-400">{holding.marketCode}</p>
          <p className="text-xs text-slate-500">
            {formatQuantity(holding.quantity)}
            {holding.avgPrice ? ` · 평단 ${holding.avgPrice.toLocaleString()}원` : ''}
          </p>
        </div>

        <div className="flex-shrink-0 text-right">
          <p className="font-semibold text-slate-800">
            {Math.round(calculateCryptoHoldingValue(holding)).toLocaleString()}원
          </p>
          {showHoldingProfit && (
            <p className={`text-xs ${isHoldingProfit ? 'text-red-500' : 'text-blue-500'}`}>
              {isHoldingProfit ? '+' : ''}
              {holdingProfitRate.toFixed(2)}%
              <span className="ml-1">
                ({isHoldingProfit ? '+' : ''}
                {Math.round(holdingProfitLoss).toLocaleString()})
              </span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
