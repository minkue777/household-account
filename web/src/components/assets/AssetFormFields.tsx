'use client';

import { AssetType, ASSET_TYPE_CONFIG } from '@/types/asset';
import { Banknote, BarChart3, Home, Coins, CircleMinus } from 'lucide-react';

const ICONS: Record<AssetType, React.ReactNode> = {
  savings: <Banknote className="w-5 h-5" />,
  stock: <BarChart3 className="w-5 h-5" />,
  property: <Home className="w-5 h-5" />,
  gold: <Coins className="w-5 h-5" />,
  loan: <CircleMinus className="w-5 h-5" />,
};

interface AssetTypeGridProps {
  value: AssetType;
  onChange: (type: AssetType) => void;
  itemLabelClassName?: string;
}

export function AssetTypeGrid({
  value,
  onChange,
  itemLabelClassName = 'text-xs font-medium',
}: AssetTypeGridProps) {
  return (
    <div className="grid grid-cols-5 gap-2">
      {(Object.keys(ASSET_TYPE_CONFIG) as AssetType[]).map((type) => {
        const config = ASSET_TYPE_CONFIG[type];
        const isSelected = value === type;

        return (
          <button
            key={type}
            type="button"
            onClick={() => onChange(type)}
            className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all ${
              isSelected
                ? 'border-blue-500 bg-blue-50'
                : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <span style={{ color: isSelected ? config.color : '#64748b' }}>
              {ICONS[type]}
            </span>
            <span className={`${itemLabelClassName} ${isSelected ? 'text-blue-600' : 'text-slate-600'}`}>
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
