'use client';

import { AssetType, ASSET_TYPE_CONFIG } from '@/types/asset';
import { ASSET_TYPE_ICON_COMPONENTS } from './assetIcons';

interface AssetTypeGridProps {
  value: AssetType;
  onChange: (type: AssetType) => void;
  itemLabelClassName?: string;
}

export function AssetTypeGrid({
  value,
  onChange,
  itemLabelClassName = 'text-[11px] sm:text-xs font-medium',
}: AssetTypeGridProps) {
  return (
    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6 sm:gap-2">
      {(Object.keys(ASSET_TYPE_CONFIG) as AssetType[]).map((type) => {
        const config = ASSET_TYPE_CONFIG[type];
        const isSelected = value === type;
        const Icon = ASSET_TYPE_ICON_COMPONENTS[type];

        return (
          <button
            key={type}
            type="button"
            onClick={() => onChange(type)}
            className={`flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-xl border-2 px-2 py-2.5 transition-all sm:min-h-[84px] sm:p-3 ${
              isSelected
                ? 'bg-white'
                : 'border-slate-200 hover:border-slate-300'
            }`}
            style={
              isSelected
                ? {
                    borderColor: config.color,
                    backgroundColor: `${config.color}12`,
                  }
                : undefined
            }
          >
            <span style={{ color: isSelected ? config.color : '#64748b' }}>
              <Icon className="w-5 h-5" />
            </span>
            <span
              className={`whitespace-nowrap leading-none tracking-[-0.01em] ${itemLabelClassName}`}
              style={{ color: isSelected ? config.color : '#475569' }}
            >
              {config.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface StockInitialInvestmentFieldProps {
  value: string;
  onChange: (value: string) => void;
}

export function StockInitialInvestmentField({ value, onChange }: StockInitialInvestmentFieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">
        투자원금
        <span className="text-xs text-slate-400 ml-2">(선택)</span>
      </label>
      <div className="relative">
        <input
          type="text"
          inputMode="numeric"
          value={value ? parseInt(value, 10).toLocaleString() : ''}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))}
          placeholder="0"
          className="w-full px-4 py-2 pr-8 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">원</span>
      </div>
      <p className="text-xs text-slate-500 mt-1">계좌 전체 수익률을 계산할 때 사용합니다.</p>
    </div>
  );
}

interface SavingsRecurringFieldsProps {
  amountValue: string;
  dayValue: string;
  onAmountChange: (value: string) => void;
  onDayChange: (value: string) => void;
}

export function SavingsRecurringFields({
  amountValue,
  dayValue,
  onAmountChange,
  onDayChange,
}: SavingsRecurringFieldsProps) {
  return (
    <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/70 p-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          월 납입금
          <span className="text-xs text-slate-400 ml-2">(선택)</span>
        </label>
        <div className="relative">
          <input
            type="text"
            inputMode="numeric"
            value={amountValue ? parseInt(amountValue, 10).toLocaleString() : ''}
            onChange={(e) => onAmountChange(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="0"
            className="w-full px-4 py-2 pr-8 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">원</span>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          납입일
          <span className="text-xs text-slate-400 ml-2">(선택)</span>
        </label>
        <div className="relative">
          <input
            type="text"
            inputMode="numeric"
            value={dayValue}
            onChange={(e) => onDayChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
            placeholder="예: 25"
            className="w-full px-4 py-2 pr-8 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">일</span>
        </div>
      </div>
    </div>
  );
}

interface AssetMemoFieldProps {
  value: string;
  onChange: (value: string) => void;
}

export function AssetMemoField({ value, onChange }: AssetMemoFieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">메모 (선택)</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="메모 입력"
        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}
