'use client';

import { useState, useEffect } from 'react';
import { Asset } from '@/types/asset';
import { updateAsset } from '@/lib/assetService';
import { Portal } from '@/components/common';
import { X, Loader2, RefreshCw } from 'lucide-react';

interface GoldPriceData {
  pricePerGram: number;
  pricePerDon: number;
  goldUsdPerOz: number;
  usdKrw: number;
  timestamp: string;
  estimated?: boolean;
}

interface GoldHoldingModalProps {
  isOpen: boolean;
  onClose: () => void;
  asset: Asset | null;
}

export default function GoldHoldingModal({ isOpen, onClose, asset }: GoldHoldingModalProps) {
  const [quantity, setQuantity] = useState(''); // 돈 단위
  const [goldPrice, setGoldPrice] = useState<GoldPriceData | null>(null);
  const [isLoadingPrice, setIsLoadingPrice] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 현재 보유량 불러오기
  useEffect(() => {
    if (isOpen && asset) {
      // memo에서 돈 단위 추출 (예: "40돈")
      const match = asset.memo?.match(/(\d+(?:\.\d+)?)\s*돈/);
      if (match) {
        setQuantity(match[1]);
      } else {
        setQuantity('');
      }
      fetchGoldPrice();
    }
  }, [isOpen, asset]);

  // 금 시세 조회
  const fetchGoldPrice = async () => {
    setIsLoadingPrice(true);
    try {
      const response = await fetch('/api/gold/price');
      if (response.ok) {
        const data = await response.json();
        setGoldPrice(data);
      }
    } catch (error) {
      console.error('금 시세 조회 오류:', error);
    } finally {
      setIsLoadingPrice(false);
    }
  };

  // 평가금액 계산
  const totalValue = goldPrice && quantity
    ? Math.round(goldPrice.pricePerDon * parseFloat(quantity))
    : 0;

  // 저장
  const handleSave = async () => {
    if (!asset || !quantity || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await updateAsset(asset.id, {
        currentBalance: totalValue,
        memo: `${quantity}돈`,
      });
      onClose();
    } catch (error) {
      console.error('금 보유량 저장 오류:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !asset) return null;

  return (
    <Portal>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]">
        <div className="bg-white rounded-2xl p-6 m-4 max-w-md w-full shadow-xl">
          {/* 헤더 */}
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

          {/* 현재 금 시세 */}
          <div className="bg-amber-50 rounded-xl p-4 mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-amber-700">현재 금 시세</span>
              <button
                onClick={fetchGoldPrice}
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
              <div className="space-y-1">
                <p className="text-2xl font-bold text-amber-700">
                  {goldPrice.pricePerDon.toLocaleString()}
                  <span className="text-base font-medium ml-1">원/돈</span>
                </p>
                <p className="text-xs text-amber-600">
                  {goldPrice.pricePerGram.toLocaleString()}원/g ·
                  ${goldPrice.goldUsdPerOz}/oz ·
                  환율 {goldPrice.usdKrw}원
                  {goldPrice.estimated && ' (추정치)'}
                </p>
              </div>
            ) : (
              <p className="text-amber-600">시세를 불러올 수 없습니다</p>
            )}
          </div>

          {/* 보유량 입력 */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                보유량 (돈)
              </label>
              <div className="relative">
                <input
                  type="text"
                  inputMode="decimal"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value.replace(/[^0-9.]/g, ''))}
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

            {/* 평가금액 미리보기 */}
            {quantity && parseFloat(quantity) > 0 && goldPrice && (
              <div className="bg-slate-50 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">평가금액</span>
                  <span className="text-xl font-bold text-slate-800">
                    {totalValue.toLocaleString()}원
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1 text-right">
                  {goldPrice.pricePerDon.toLocaleString()}원 × {parseFloat(quantity)}돈
                </p>
              </div>
            )}
          </div>

          {/* 버튼 */}
          <div className="flex gap-3 mt-6">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 px-4 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleSave}
              disabled={!quantity || !goldPrice || isSubmitting}
              className="flex-1 py-2.5 px-4 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              {isSubmitting ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
