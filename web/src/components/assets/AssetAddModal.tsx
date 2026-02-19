'use client';

import { useEffect, useState } from 'react';
import { AssetInput, AssetType, ASSET_OWNERS } from '@/types/asset';
import { addAsset } from '@/lib/assetService';
import { Portal } from '@/components/common';
import { X } from 'lucide-react';
import { AssetMemoField, AssetTypeGrid, StockInitialInvestmentField } from './AssetFormFields';

interface AssetAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultType?: AssetType;
  defaultOwner?: string;
}

const PLACEHOLDERS: Record<AssetType, string> = {
  savings: '예: 비상금 통장, 체크카드',
  stock: '예: 주식계좌, ISA, 연금저축',
  property: '예: 전세보증금, 청약통장',
  gold: '예: KRX 금현물, 금통장',
};

export default function AssetAddModal({
  isOpen,
  onClose,
  defaultType = 'savings',
  defaultOwner,
}: AssetAddModalProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<AssetType>(defaultType);
  const [owner, setOwner] = useState<string>(ASSET_OWNERS[0]);
  const [balance, setBalance] = useState('');
  const [initialInvestment, setInitialInvestment] = useState('');
  const [memo, setMemo] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setName('');
    setBalance('');
    setInitialInvestment('');
  }, [type]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setType(defaultType);
    const initialOwner = defaultOwner && ASSET_OWNERS.includes(defaultOwner as (typeof ASSET_OWNERS)[number])
      ? defaultOwner
      : ASSET_OWNERS[0];
    setOwner(initialOwner);
    setName('');
    setBalance('');
    setInitialInvestment('');
    setMemo('');
  }, [defaultOwner, defaultType, isOpen]);

  const handleSubmit = async () => {
    if (isSubmitting || !name.trim()) {
      return;
    }

    setIsSubmitting(true);
    try {
      const input: AssetInput = {
        name: name.trim(),
        type,
        owner,
        currentBalance: parseInt(balance, 10) || 0,
        currency: 'KRW',
        memo: memo.trim() || undefined,
        isActive: true,
        order: Date.now(),
        ...(type === 'stock' && initialInvestment
          ? { initialInvestment: parseInt(initialInvestment, 10) }
          : {}),
      };

      await addAsset(input);
      onClose();
    } catch (error) {
      console.error('자산 추가 오류:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <Portal>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]">
        <div className="bg-white rounded-2xl p-6 m-4 max-w-md w-full shadow-xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-slate-800">자산 추가</h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">유형</label>
              <AssetTypeGrid
                value={type}
                onChange={setType}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">소유자</label>
              <div className="flex flex-wrap gap-2">
                {ASSET_OWNERS.map((ownerOption) => (
                  <button
                    key={ownerOption}
                    type="button"
                    onClick={() => setOwner(ownerOption)}
                    className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                      owner === ownerOption
                        ? 'bg-blue-500 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {ownerOption}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">계좌명</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={PLACEHOLDERS[type]}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">현재 잔액</label>
              <div className="relative">
                <input
                  type="text"
                  inputMode="numeric"
                  value={balance ? parseInt(balance, 10).toLocaleString() : ''}
                  onChange={(e) => setBalance(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="0"
                  className="w-full px-4 py-2 pr-8 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">원</span>
              </div>
            </div>

            {type === 'stock' && (
              <StockInitialInvestmentField
                value={initialInvestment}
                onChange={setInitialInvestment}
              />
            )}

            <AssetMemoField
              value={memo}
              onChange={setMemo}
            />
          </div>

          <div className="flex gap-3 mt-6">
            <button
              onClick={onClose}
              className="flex-1 py-2 px-4 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || !name.trim()}
              className="flex-1 py-2 px-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              {isSubmitting ? '추가 중..' : '추가'}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
