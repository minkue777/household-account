'use client';

import { Asset } from '@/types/asset';
import { ModalOverlay } from '@/components/common';
import { X, Loader2, RefreshCw } from 'lucide-react';
import { useGoldHolding } from '@/lib/utils/useGoldHolding';

interface GoldHoldingModalProps {
  isOpen: boolean;
  onClose: () => void;
  asset: Asset | null;
}

export default function GoldHoldingModal({ isOpen, onClose, asset }: GoldHoldingModalProps) {
  const {
    quantity,
    setQuantityInput,
    goldPrice,
    isLoadingPrice,
    refreshGoldPrice,
    totalValue,
    isSaving,
    saveGoldHolding,
  } = useGoldHolding({ isOpen, asset });

  const parsedQuantity = quantity ? parseFloat(quantity) : 0;

  const handleSave = async () => {
    const saved = await saveGoldHolding();
    if (saved) {
      onClose();
    }
  };

  if (!isOpen || !asset) {
    return null;
  }

  return (
    <ModalOverlay onClose={onClose}>
        <div className="bg-white rounded-2xl p-6 m-4 max-w-md w-full shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-slate-800">{asset.name}</h2>
              <p className="text-sm text-slate-500">금 보유량 관리</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>

          <div className="bg-amber-50 rounded-xl p-4 mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-amber-700">현재 금 시세</span>
              <button
                onClick={() => {
                  void refreshGoldPrice();
                }}
                disabled={isLoadingPrice}
                className="p-1 text-amber-600 hover:bg-amber-100 rounded transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${isLoadingPrice ? 'animate-spin' : ''}`} />
              </button>
            </div>
            {isLoadingPrice ? (
              <div className="flex items-center gap-2 text-amber-600">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>시세 조회 중..</span>
              </div>
            ) : goldPrice ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white rounded-lg p-3">
                  <p className="text-xs text-slate-500 mb-1">구매가 (1돈)</p>
                  <p className="text-lg font-bold text-red-500">
                    {goldPrice.buyPricePerDon.toLocaleString()}
                    <span className="text-sm font-normal text-slate-400 ml-1">원</span>
                  </p>
                </div>
                <div className="bg-white rounded-lg p-3">
                  <p className="text-xs text-slate-500 mb-1">판매가 (1돈)</p>
                  <p className="text-lg font-bold text-blue-500">
                    {goldPrice.sellPricePerDon.toLocaleString()}
                    <span className="text-sm font-normal text-slate-400 ml-1">원</span>
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-amber-600">시세를 불러올 수 없습니다.</p>
            )}
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">보유량 (돈)</label>
              <div className="relative">
                <input
                  type="text"
                  inputMode="decimal"
                  value={quantity}
                  onChange={(e) => setQuantityInput(e.target.value)}
                  placeholder="0"
                  className="w-full px-4 py-3 pr-12 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 text-lg"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-medium">
                  돈
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">1돈 = 3.75g (순금 24K 기준)</p>
            </div>

            {parsedQuantity > 0 && goldPrice && (
              <div className="bg-slate-50 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">평가금액 (판매가 기준)</span>
                  <span className="text-xl font-bold text-slate-800">
                    {totalValue.toLocaleString()}원
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1 text-right">
                  {goldPrice.sellPricePerDon.toLocaleString()}원 × {parsedQuantity}돈
                </p>
              </div>
            )}
          </div>

          <div className="flex gap-3 mt-6">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 px-4 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
            >
              취소
            </button>
            <button
              onClick={() => {
                void handleSave();
              }}
              disabled={!quantity || !goldPrice || isSaving}
              className="flex-1 py-2.5 px-4 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              {isSaving ? '저장 중..' : '저장'}
            </button>
          </div>
        </div>
    </ModalOverlay>
  );
}
