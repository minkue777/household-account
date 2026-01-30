'use client';

import { Asset, ASSET_TYPE_CONFIG, AssetType } from '@/types/asset';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface AssetSummaryCardProps {
  assets: Asset[];
  monthlyChange: number;
}

export default function AssetSummaryCard({ assets, monthlyChange }: AssetSummaryCardProps) {
  // 총 자산 계산
  const totalBalance = assets
    .filter((a) => a.isActive)
    .reduce((sum, a) => sum + a.currentBalance, 0);

  // 타입별 자산 합계
  const typeBalances: Record<AssetType, number> = {
    bank: 0,
    investment: 0,
    property: 0,
  };

  assets
    .filter((a) => a.isActive)
    .forEach((a) => {
      typeBalances[a.type] += a.currentBalance;
    });

  const isPositive = monthlyChange > 0;
  const isNegative = monthlyChange < 0;

  return (
    <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-6 text-white shadow-lg">
      {/* 총 자산 */}
      <div className="mb-4">
        <p className="text-slate-400 text-sm mb-1">총 자산</p>
        <p className="text-3xl font-bold">
          {totalBalance.toLocaleString()}
          <span className="text-lg font-normal text-slate-400 ml-1">원</span>
        </p>
      </div>

      {/* 이번 달 변동 */}
      <div className="flex items-center gap-2 mb-6">
        {isPositive ? (
          <TrendingUp className="w-4 h-4 text-green-400" />
        ) : isNegative ? (
          <TrendingDown className="w-4 h-4 text-red-400" />
        ) : (
          <Minus className="w-4 h-4 text-slate-400" />
        )}
        <span
          className={`text-sm font-medium ${
            isPositive ? 'text-green-400' : isNegative ? 'text-red-400' : 'text-slate-400'
          }`}
        >
          이번 달 {isPositive ? '+' : ''}
          {monthlyChange.toLocaleString()}원
        </span>
      </div>

      {/* 타입별 요약 */}
      <div className="grid grid-cols-3 gap-4">
        {(Object.keys(ASSET_TYPE_CONFIG) as AssetType[]).map((type) => {
          const config = ASSET_TYPE_CONFIG[type];
          const balance = typeBalances[type];
          const percentage = totalBalance > 0 ? Math.round((balance / totalBalance) * 100) : 0;

          return (
            <div key={type} className="text-center">
              <div
                className="w-10 h-10 rounded-full mx-auto mb-2 flex items-center justify-center"
                style={{ backgroundColor: `${config.color}30` }}
              >
                <span className="text-lg" style={{ color: config.color }}>
                  {config.label.slice(0, 1)}
                </span>
              </div>
              <p className="text-xs text-slate-400 mb-0.5">{config.label}</p>
              <p className="text-sm font-semibold">
                {balance >= 100000000
                  ? `${(balance / 100000000).toFixed(1)}억`
                  : balance >= 10000
                  ? `${Math.floor(balance / 10000)}만`
                  : balance.toLocaleString()}
              </p>
              <p className="text-xs text-slate-500">{percentage}%</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
