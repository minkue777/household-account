'use client';

import { Loader2, RefreshCw } from 'lucide-react';
import type { GoldPriceData } from '@/lib/utils/useGoldHolding';

export interface GoldHoldingState {
  quantity: string;
  setQuantityInput: (value: string) => void;
  goldPrice: GoldPriceData | null;
  isLoadingPrice: boolean;
  refreshGoldPrice: () => void;
  totalValue: number;
  isSaving: boolean;
}

interface GoldHoldingSectionProps {
  state: GoldHoldingState;
  onSave: () => void;
}

export default function GoldHoldingSection({ state, onSave }: GoldHoldingSectionProps) {
  const {
    quantity,
    setQuantityInput,
    goldPrice,
    isLoadingPrice,
    refreshGoldPrice,
    totalValue,
    isSaving,
  } = state;

  return (
    <div className="space-y-4">
      {/* 금 시세 */}
      <div className="bg-amber-50 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-amber-700">현재 금 시세 (1돈)</span>
          <button
            type="button"
            onClick={refreshGoldPrice}
            disabled={isLoadingPrice}
            className="p-1 text-amber-600 hover:bg-amber-100 rounded transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isLoadingPrice ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {isLoadingPrice ? (
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
            value={quantity}
            onChange={(e) => setQuantityInput(e.target.value.replace(/[^0-9.]/g, ''))}
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
      {quantity && parseFloat(quantity) > 0 && goldPrice && (
        <div className="bg-slate-50 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-slate-600">평가금액 (팔 때 기준)</span>
            <span className="text-xl font-bold text-slate-800">
              {totalValue.toLocaleString()}원
            </span>
          </div>
        </div>
      )}

      {/* 저장 버튼 */}
      <button
        type="button"
        onClick={onSave}
        disabled={!quantity || !goldPrice || isSaving}
        className="w-full py-3 bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed font-medium"
      >
        {isSaving ? '저장 중...' : '저장'}
      </button>
    </div>
  );
}
