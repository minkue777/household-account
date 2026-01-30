'use client';

import { Asset, ASSET_TYPE_CONFIG } from '@/types/asset';
import { Building2, TrendingUp, Home, TrendingDown } from 'lucide-react';

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

  // 변동률 계산 (이전 잔액 대비)
  const changeRate = lastChange && lastChange.amount !== 0
    ? ((lastChange.amount / (asset.currentBalance - lastChange.amount)) * 100)
    : 0;

  const hasPositiveChange = lastChange && lastChange.amount > 0;
  const hasNegativeChange = lastChange && lastChange.amount < 0;

  return (
    <button
      onClick={onClick}
      className="w-full bg-white rounded-xl p-4 shadow-sm border border-slate-100 hover:shadow-md hover:border-slate-200 transition-all text-left"
    >
      <div className="flex items-center gap-3">
        {/* 아이콘 */}
        <div
          className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${iconColor}15`, color: iconColor }}
        >
          {ICONS[asset.type]}
        </div>

        {/* 정보 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-slate-800 truncate">{asset.name}</h3>
            {asset.subType && (
              <span className="text-xs px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded flex-shrink-0">
                {asset.subType}
              </span>
            )}
          </div>
          {asset.memo && (
            <p className="text-xs text-slate-400 truncate mt-0.5">{asset.memo}</p>
          )}
        </div>

        {/* 금액 & 변동 */}
        <div className="text-right flex-shrink-0">
          <p className="font-semibold text-slate-900">
            {asset.currentBalance.toLocaleString()}
            <span className="text-xs font-normal text-slate-400 ml-0.5">원</span>
          </p>
          {lastChange && lastChange.amount !== 0 && (
            <div className={`flex items-center justify-end gap-0.5 text-xs mt-0.5 ${
              hasPositiveChange ? 'text-green-500' : 'text-red-500'
            }`}>
              {hasPositiveChange ? (
                <TrendingUp className="w-3 h-3" />
              ) : (
                <TrendingDown className="w-3 h-3" />
              )}
              <span>
                {hasPositiveChange ? '+' : ''}{lastChange.amount.toLocaleString()}
              </span>
              {changeRate !== 0 && !isNaN(changeRate) && isFinite(changeRate) && (
                <span className="text-slate-400 ml-1">
                  ({changeRate > 0 ? '+' : ''}{changeRate.toFixed(1)}%)
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
