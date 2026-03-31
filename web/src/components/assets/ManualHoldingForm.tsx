'use client';

import type { ManualHoldingType } from '@/lib/utils/useStockHoldingManager';

interface ManualHoldingFormProps {
  holdingType: ManualHoldingType;
  onHoldingTypeChange: (value: ManualHoldingType) => void;
  name: string;
  onNameChange: (value: string) => void;
  currentValue: string;
  onCurrentValueChange: (value: string) => void;
  purchaseValue: string;
  onPurchaseValueChange: (value: string) => void;
  isAdding: boolean;
  onAdd: () => void;
}

export default function ManualHoldingForm({
  holdingType,
  onHoldingTypeChange,
  name,
  onNameChange,
  currentValue,
  onCurrentValueChange,
  purchaseValue,
  onPurchaseValueChange,
  isAdding,
  onAdd,
}: ManualHoldingFormProps) {
  return (
    <div className="border-b border-blue-200 bg-blue-100 p-4">
      <div className="space-y-3">
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">수동 항목 유형</label>
          <div className="flex gap-2">
            {(['bond', 'cash'] as ManualHoldingType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => onHoldingTypeChange(type)}
                className={`rounded-full px-3 py-1.5 text-sm transition-all ${
                  holdingType === type
                    ? 'bg-blue-500 text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {type === 'bond' ? '채권' : '예수금'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">항목명</label>
          <input
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder={holdingType === 'bond' ? '예: 신한라이프생명보험3(후)' : '예: 신한투자증권 예수금'}
            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">평가금액</label>
            <div className="relative">
              <input
                type="text"
                inputMode="numeric"
                value={currentValue ? parseInt(currentValue, 10).toLocaleString() : ''}
                onChange={(e) => onCurrentValueChange(e.target.value)}
                placeholder="0"
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">원</span>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">매수금액 (선택)</label>
            <div className="relative">
              <input
                type="text"
                inputMode="numeric"
                value={purchaseValue ? parseInt(purchaseValue, 10).toLocaleString() : ''}
                onChange={(e) => onPurchaseValueChange(e.target.value)}
                placeholder="0"
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">원</span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onAdd}
          disabled={!name.trim() || !currentValue || isAdding}
          className="w-full rounded-lg bg-blue-500 py-2.5 font-medium text-white transition-colors hover:bg-blue-600 disabled:bg-slate-300"
        >
          {isAdding ? '추가 중..' : `${holdingType === 'bond' ? '채권' : '예수금'} 추가`}
        </button>
      </div>
    </div>
  );
}
