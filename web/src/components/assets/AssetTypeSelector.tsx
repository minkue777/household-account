'use client';

import { AssetType, ASSET_TYPE_CONFIG } from '@/types/asset';
import { Banknote, BarChart3, Home, Coins } from 'lucide-react';

interface AssetTypeSelectorProps {
  selectedType: AssetType;
  onTypeChange: (type: AssetType) => void;
  assetCounts?: Record<AssetType, number>;
}

const ICONS: Record<AssetType, React.ReactNode> = {
  savings: <Banknote className="w-4 h-4" />,
  stock: <BarChart3 className="w-4 h-4" />,
  property: <Home className="w-4 h-4" />,
  gold: <Coins className="w-4 h-4" />,
};

export default function AssetTypeSelector({
  selectedType,
  onTypeChange,
  assetCounts = { savings: 0, stock: 0, property: 0, gold: 0 },
}: AssetTypeSelectorProps) {
  return (
    <div className="flex gap-2 p-1 bg-slate-100 rounded-xl">
      {(Object.keys(ASSET_TYPE_CONFIG) as AssetType[]).map((type) => {
        const config = ASSET_TYPE_CONFIG[type];
        const isSelected = selectedType === type;
        const count = assetCounts[type];

        return (
          <button
            key={type}
            onClick={() => onTypeChange(type)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-medium text-sm transition-all ${
              isSelected
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <span style={{ color: isSelected ? config.color : undefined }}>
              {ICONS[type]}
            </span>
            <span>{config.label}</span>
            {count > 0 && (
              <span
                className={`text-xs px-1.5 py-0.5 rounded-full ${
                  isSelected ? 'bg-slate-100 text-slate-600' : 'bg-slate-200 text-slate-500'
                }`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
