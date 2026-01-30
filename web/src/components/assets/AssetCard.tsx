'use client';

import { Asset, ASSET_TYPE_CONFIG } from '@/types/asset';
import { Building2, TrendingUp, Home, ChevronRight } from 'lucide-react';

interface AssetCardProps {
  asset: Asset;
  lastChange?: {
    amount: number;
    date: string;
  };
  onClick: () => void;
}

const ICONS: Record<string, React.ReactNode> = {
  bank: <Building2 className="w-5 h-5" />,
  investment: <TrendingUp className="w-5 h-5" />,
  property: <Home className="w-5 h-5" />,
};

export default function AssetCard({ asset, lastChange, onClick }: AssetCardProps) {
  const config = ASSET_TYPE_CONFIG[asset.type];
  const iconColor = asset.color || config.color;

  return (
    <button
      onClick={onClick}
      className="w-full bg-white rounded-xl p-4 shadow-sm border border-slate-100 hover:shadow-md hover:border-slate-200 transition-all text-left"
    >
      <div className="flex items-center gap-3">
        {/* 아이콘 */}
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${iconColor}15`, color: iconColor }}
        >
          {ICONS[asset.type]}
        </div>

        {/* 정보 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-slate-800 truncate">{asset.name}</h3>
            {asset.subType && (
              <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full flex-shrink-0">
                {asset.subType}
              </span>
            )}
          </div>
          <p className="text-xl font-bold text-slate-900 mt-0.5">
            {asset.currentBalance.toLocaleString()}
            <span className="text-sm font-normal text-slate-400 ml-0.5">원</span>
          </p>
          {lastChange && lastChange.amount !== 0 && (
            <p
              className={`text-xs mt-1 ${
                lastChange.amount > 0 ? 'text-green-500' : 'text-red-500'
              }`}
            >
              {lastChange.amount > 0 ? '+' : ''}
              {lastChange.amount.toLocaleString()}원 ({lastChange.date.slice(5)})
            </p>
          )}
        </div>

        {/* 화살표 */}
        <ChevronRight className="w-5 h-5 text-slate-300 flex-shrink-0" />
      </div>
    </button>
  );
}
