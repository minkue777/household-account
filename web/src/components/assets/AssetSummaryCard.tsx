'use client';

import { useMemo } from 'react';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';
import { Asset, ASSET_TYPE_CONFIG, AssetType } from '@/types/asset';
import { TrendingUp, TrendingDown } from 'lucide-react';

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
        backgroundColor: typeData.map((d) => ASSET_TYPE_CONFIG[d.type].color),
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
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
      {/* 총 자산 */}
      <div className="text-center mb-6">
        <p className="text-slate-500 text-sm mb-2">총 자산</p>
        <p className="text-3xl font-bold text-slate-900">
          {totalBalance.toLocaleString()}
          <span className="text-lg font-normal text-slate-400 ml-1">원</span>
        </p>
        {/* 변동률 */}
        {monthlyChange !== 0 && (
          <div className="flex items-center justify-center gap-1 mt-2">
            {isPositive ? (
              <TrendingUp className="w-4 h-4 text-green-500" />
            ) : (
              <TrendingDown className="w-4 h-4 text-red-500" />
            )}
            <span className={`text-sm font-medium ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
              {changeRate !== 0 && `${changeRate > 0 ? '+' : ''}${changeRate.toFixed(2)}%`}
              {' '}
              {isPositive ? '+' : ''}{monthlyChange.toLocaleString()}원
            </span>
          </div>
        )}
      </div>

      {/* 도넛 차트 + 범례 */}
      <div className="flex items-center gap-6">
        {/* 차트 */}
        <div className="w-32 h-32 flex-shrink-0">
          <Doughnut data={chartData} options={chartOptions} />
        </div>

        {/* 범례 */}
        <div className="flex-1 space-y-2">
          {typeData.map((item) => {
            const config = ASSET_TYPE_CONFIG[item.type];
            return (
              <div key={item.type} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: config.color }}
                  />
                  <span className="text-sm text-slate-600">{config.label}</span>
                </div>
                <span className="text-sm font-medium text-slate-800">
                  {item.percentage.toFixed(1)}%
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
  );
}
