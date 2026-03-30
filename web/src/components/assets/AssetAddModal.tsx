'use client';

import { useEffect, useState } from 'react';
import { AssetInput, AssetType } from '@/types/asset';
import { addAsset } from '@/lib/assetService';
import { ModalOverlay } from '@/components/common';
import { X } from 'lucide-react';
import { AssetMemoField, AssetTypeGrid, StockInitialInvestmentField } from './AssetFormFields';
import { HOUSEHOLD_OWNER_OPTION } from '@/lib/assets/memberOptions';

interface AssetAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultType?: AssetType;
  defaultOwner?: string;
  ownerOptions: string[];
}

const PLACEHOLDERS: Record<AssetType, string> = {
  savings: '예: 비상금 통장, 체크카드',
  stock: '예: 주식계좌, ISA, 연금저축',
  property: '예: 전세보증금, 청약통장',
  gold: '예: KRX 금현물, 금통장',
  loan: '예: 전세대출, 신용대출',
};

export default function AssetAddModal({
  isOpen,
  onClose,
  defaultType = 'savings',
  defaultOwner,
  ownerOptions,
}: AssetAddModalProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<AssetType>(defaultType);
  const [owner, setOwner] = useState(ownerOptions[0] || HOUSEHOLD_OWNER_OPTION);
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
    const initialOwner =
      defaultOwner && ownerOptions.includes(defaultOwner)
        ? defaultOwner
        : ownerOptions[0] || HOUSEHOLD_OWNER_OPTION;
    setOwner(initialOwner);
    setName('');
    setBalance('');
    setInitialInvestment('');
    setMemo('');
  }, [defaultOwner, defaultType, isOpen, ownerOptions]);

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
    <ModalOverlay onClose={onClose}>
      <div className="m-4 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-slate-800">자산 추가</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 transition-colors hover:bg-slate-100"
          >
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">유형</label>
            <AssetTypeGrid value={type} onChange={setType} />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">소유자</label>
            <div className="flex flex-wrap gap-2">
              {ownerOptions.map((ownerOption) => (
                <button
                  key={ownerOption}
                  type="button"
                  onClick={() => setOwner(ownerOption)}
                  className={`rounded-full px-3 py-1.5 text-sm transition-all ${
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
            <label className="mb-1 block text-sm font-medium text-slate-700">계좌명</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={PLACEHOLDERS[type]}
              className="w-full rounded-lg border border-slate-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">현재 금액</label>
            <div className="relative">
              <input
                type="text"
                inputMode="numeric"
                value={balance ? parseInt(balance, 10).toLocaleString() : ''}
                onChange={(e) => setBalance(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="0"
                className="w-full rounded-lg border border-slate-300 px-4 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-blue-500"
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

          <AssetMemoField value={memo} onChange={setMemo} />
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-slate-600 transition-colors hover:bg-slate-50"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !name.trim()}
            className="flex-1 rounded-lg bg-blue-500 px-4 py-2 text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isSubmitting ? '추가 중...' : '추가'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}
