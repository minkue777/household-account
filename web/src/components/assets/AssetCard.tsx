'use client';

import { Asset, ASSET_TYPE_CONFIG } from '@/types/asset';
import { Banknote, BarChart3, Home, Coins, CircleMinus } from 'lucide-react';
import { getAssetSignedBalance } from '@/lib/assets/assetMath';

interface AssetCardProps {
  asset: Asset;
  lastChange?: {
    amount: number;
    date: string;
  };
  onClick: () => void;
}

const ICONS: Record<string, React.ReactNode> = {
  savings: <Banknote className="w-5 h-5" />,
  stock: <BarChart3 className="w-5 h-5" />,
  property: <Home className="w-5 h-5" />,
  gold: <Coins className="w-5 h-5" />,
  loan: <CircleMinus className="w-5 h-5" />,
};

export default function AssetCard({ asset, onClick }: AssetCardProps) {
  const config = ASSET_TYPE_CONFIG[asset.type];
  const iconColor = asset.color || config.color;

  // 주식 계좌: 수익률 계산 (평가금액 vs 투자원금)
  const isStock = asset.type === 'stock';
  const signedBalance = getAssetSignedBalance(asset);
  const investmentBase = asset.initialInvestment || asset.costBasis || 0; // 투자원금 또는 평단가 합계
  const profitLoss = isStock && investmentBase > 0 ? asset.currentBalance - investmentBase : 0;
  const profitLossRate = isStock && investmentBase > 0 ? (profitLoss / investmentBase) * 100 : 0;
  const showProfitLoss = isStock && investmentBase > 0;
  const isProfit = profitLoss >= 0;

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
          {asset.owner && ` · ${asset.owner}`}
          {asset.memo && ` · ${asset.memo}`}
        </p>
      </div>

      {/* 금액 & 수익률 (주식만) */}
      <div className="text-right flex-shrink-0">
        <p className="font-semibold text-slate-900">
          {signedBalance.toLocaleString()}
          <span className="text-xs font-normal text-slate-400 ml-0.5">원</span>
        </p>
        {showProfitLoss && (
          <p className={`text-xs ${isProfit ? 'text-red-500' : 'text-blue-500'}`}>
            {isProfit ? '+' : ''}{profitLossRate.toFixed(2)}%
            <span className="ml-1">
              ({isProfit ? '+' : ''}{profitLoss.toLocaleString()})
            </span>
          </p>
        )}
      </div>
    </button>
  );
}
