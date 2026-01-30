'use client';

import { Asset, ASSET_TYPE_CONFIG } from '@/types/asset';
import { Building2, Activity, Home, Coins } from 'lucide-react';

interface AssetCardProps {
  asset: Asset;
  lastChange?: {
    amount: number;
    date: string;
  };
  onClick: () => void;
}

const ICONS: Record<string, React.ReactNode> = {
  savings: <Building2 className="w-5 h-5" />,
  stock: <Activity className="w-5 h-5" />,
  property: <Home className="w-5 h-5" />,
  gold: <Coins className="w-5 h-5" />,
};

export default function AssetCard({ asset, lastChange, onClick }: AssetCardProps) {
  const config = ASSET_TYPE_CONFIG[asset.type];
  const iconColor = asset.color || config.color;

  // 주식 타입만 변동 표시
  const showChange = asset.type === 'stock' && lastChange && lastChange.amount !== 0;

  // 변동률 계산 (이전 잔액 대비)
  const changeRate = showChange && (asset.currentBalance - lastChange.amount) !== 0
    ? ((lastChange.amount / (asset.currentBalance - lastChange.amount)) * 100)
    : 0;

  const hasPositiveChange = lastChange && lastChange.amount > 0;

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 py-3 text-left hover:bg-slate-50 rounded-xl px-2 -mx-2 transition-colors"
    >
      {/* 아이콘 */}
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: iconColor, color: 'white' }}
      >
        {ICONS[asset.type]}
      </div>

      {/* 이름 & 부가정보 */}
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-slate-900 truncate">{asset.name}</h3>
        <p className="text-xs text-slate-400 truncate">
          {asset.subType || config.label}
          {asset.memo && ` · ${asset.memo}`}
        </p>
      </div>

      {/* 금액 & 변동률 (주식만) */}
      <div className="text-right flex-shrink-0">
        <p className="font-semibold text-slate-900">
          {asset.currentBalance.toLocaleString()}
        </p>
        {showChange ? (
          <p className={`text-xs ${hasPositiveChange ? 'text-red-500' : 'text-blue-500'}`}>
            {hasPositiveChange ? '+' : ''}{lastChange.amount.toLocaleString()}원
            {changeRate !== 0 && !isNaN(changeRate) && isFinite(changeRate) && (
              <span className="ml-1">
                ({changeRate > 0 ? '+' : ''}{changeRate.toFixed(1)}%)
              </span>
            )}
          </p>
        ) : (
          <p className="text-xs text-slate-300">원</p>
        )}
      </div>
    </button>
  );
}
