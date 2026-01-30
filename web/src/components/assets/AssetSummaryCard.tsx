'use client';

import { useMemo } from 'react';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';
import { Asset, ASSET_TYPE_CONFIG, AssetType } from '@/types/asset';

ChartJS.register(ArcElement, Tooltip, Legend);

interface AssetSummaryCardProps {
  assets: Asset[];
  monthlyChange: number;
  previousMonthTotal?: number;
}

export default function AssetSummaryCard({ assets, monthlyChange, previousMonthTotal }: AssetSummaryCardProps) {
  // 총 자산 계산
  const totalBalance = assets
    .filter((a) => a.isActive)
    .reduce((sum, a) => sum + a.currentBalance, 0);

  // 변동률 계산
  const changeRate = useMemo(() => {
    if (previousMonthTotal && previousMonthTotal > 0) {
      return ((totalBalance - previousMonthTotal) / previousMonthTotal) * 100;
    }
    if (totalBalance > 0 && monthlyChange !== 0) {
      const prevTotal = totalBalance - monthlyChange;
      if (prevTotal > 0) {
        return (monthlyChange / prevTotal) * 100;
      }
    }
    return 0;
  }, [totalBalance, previousMonthTotal, monthlyChange]);

  // 타입별 자산 합계
  const typeData = useMemo(() => {
    const balances: { type: AssetType; balance: number; percentage: number }[] = [];

    (Object.keys(ASSET_TYPE_CONFIG) as AssetType[]).forEach((type) => {
      const balance = assets
        .filter((a) => a.isActive && a.type === type)
        .reduce((sum, a) => sum + a.currentBalance, 0);

      if (balance > 0) {
        balances.push({
          type,
          balance,
          percentage: totalBalance > 0 ? (balance / totalBalance) * 100 : 0,
        });
      }
    });

    return balances.sort((a, b) => b.balance - a.balance);
  }, [assets, totalBalance]);

  // 차트용 푸른 계열 색상
  const CHART_COLORS: Record<AssetType, string> = {
    bank: '#3B82F6',      // 파란색
    investment: '#60A5FA', // 연한 파란색
    property: '#93C5FD',   // 더 연한 파란색
  };

  // 도넛 차트 데이터
  const chartData = useMemo(() => {
    if (typeData.length === 0) {
      return {
        labels: ['자산 없음'],
        datasets: [{
          data: [1],
          backgroundColor: ['#E2E8F0'],
          borderWidth: 0,
        }],
      };
    }

    return {
      labels: typeData.map((d) => ASSET_TYPE_CONFIG[d.type].label),
      datasets: [{
        data: typeData.map((d) => d.balance),
        backgroundColor: typeData.map((d) => CHART_COLORS[d.type]),
        borderWidth: 0,
        cutout: '65%',
      }],
    };
  }, [typeData]);

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: function (context: any) {
            const value = context.raw as number;
            const percentage = totalBalance > 0 ? ((value / totalBalance) * 100).toFixed(1) : 0;
            return `${value.toLocaleString()}원 (${percentage}%)`;
          },
        },
      },
    },
  };

  const isPositive = monthlyChange > 0;
  const isNegative = monthlyChange < 0;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
      {/* 총 자산 */}
      <div className="px-5 pt-5 pb-4">
        <p className="text-[32px] font-bold text-slate-900 tracking-tight">
          {totalBalance.toLocaleString()}
          <span className="text-lg font-medium text-slate-400 ml-1">원</span>
        </p>
        {/* 변동률 */}
        <p className={`text-sm mt-1 ${isPositive ? 'text-green-500' : isNegative ? 'text-red-500' : 'text-slate-400'}`}>
          {monthlyChange !== 0 ? (
            <>
              {isPositive ? '+ ' : ''}{changeRate.toFixed(2)}%
              {isPositive ? '↑' : isNegative ? '↓' : ''}{' '}
              {isPositive ? '+' : ''}{Math.abs(monthlyChange).toLocaleString()}원
            </>
          ) : (
            '이번 달 변동 없음'
          )}
        </p>
      </div>

      {/* 구분선 */}
      <div className="border-t border-slate-100" />

      {/* 도넛 차트 + 범례 */}
      <div className="p-5">
        <div className="flex items-center">
          {/* 차트 */}
          <div className="w-[120px] h-[120px] flex-shrink-0">
            <Doughnut data={chartData} options={chartOptions} />
          </div>

          {/* 범례 */}
          <div className="flex-1 ml-6 space-y-2.5">
            {typeData.map((item) => {
              const config = ASSET_TYPE_CONFIG[item.type];
              return (
                <div key={item.type} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: CHART_COLORS[item.type] }}
                    />
                    <span className="text-sm text-slate-600">{config.label}</span>
                  </div>
                  <span className="text-sm font-medium text-slate-800">
                    {item.percentage.toFixed(2)}%
                  </span>
                </div>
              );
            })}
            {typeData.length === 0 && (
              <p className="text-sm text-slate-400">등록된 자산이 없습니다</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
