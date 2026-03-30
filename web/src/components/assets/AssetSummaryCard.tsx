'use client';

import { useMemo } from 'react';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';
import { Asset, ASSET_TYPE_CONFIG, AssetType } from '@/types/asset';
import { ALL_MEMBERS_OPTION } from '@/lib/assets/memberOptions';
import { getAssetSignedBalance, sumSignedAssetBalances } from '@/lib/assets/assetMath';

ChartJS.register(ArcElement, Tooltip, Legend);

function formatKoreanUnit(num: number): string {
  if (num === 0) return '0';

  const absNum = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  const eok = Math.floor(absNum / 100000000);
  const man = Math.floor((absNum % 100000000) / 10000);
  const rest = absNum % 10000;

  const parts: string[] = [];
  if (eok > 0) parts.push(`${eok}억`);
  if (man > 0) parts.push(`${man}만`);
  if (rest > 0) parts.push(`${rest}`);

  return sign + parts.join(' ');
}

interface AssetSummaryCardProps {
  assets: Asset[];
  dailyChange: number;
  previousMonthTotal?: number;
  selectedMember: string;
  memberOptions: string[];
  onMemberChange: (member: string) => void;
}

export default function AssetSummaryCard({
  assets,
  dailyChange,
  previousMonthTotal,
  selectedMember,
  memberOptions,
  onMemberChange,
}: AssetSummaryCardProps) {
  const filteredAssets = useMemo(() => {
    if (selectedMember === ALL_MEMBERS_OPTION) {
      return assets.filter((asset) => asset.isActive);
    }

    return assets.filter((asset) => asset.isActive && asset.owner === selectedMember);
  }, [assets, selectedMember]);

  const totalBalance = sumSignedAssetBalances(filteredAssets);
  const changeRate = useMemo(() => {
    if (previousMonthTotal && previousMonthTotal > 0) {
      return ((totalBalance - previousMonthTotal) / previousMonthTotal) * 100;
    }

    if (totalBalance > 0 && dailyChange !== 0) {
      const previousTotal = totalBalance - dailyChange;
      if (previousTotal > 0) {
        return (dailyChange / previousTotal) * 100;
      }
    }

    return 0;
  }, [dailyChange, previousMonthTotal, totalBalance]);

  const typeData = useMemo(() => {
    const balances: { type: AssetType; balance: number; percentage: number }[] = [];
    const totalLoanBalance = filteredAssets
      .filter((asset) => asset.type === 'loan')
      .reduce((sum, asset) => sum + Math.abs(asset.currentBalance || 0), 0);

    (Object.keys(ASSET_TYPE_CONFIG) as AssetType[]).forEach((type) => {
      if (type === 'loan') {
        return;
      }

      const baseBalance = filteredAssets
        .filter((asset) => asset.type === type)
        .reduce((sum, asset) => sum + Math.abs(getAssetSignedBalance(asset)), 0);

      const balance =
        type === 'property'
          ? Math.max(0, baseBalance - totalLoanBalance)
          : baseBalance;

      if (balance !== 0) {
        balances.push({
          type,
          balance,
          percentage: 0,
        });
      }
    });

    const totalChartBalance = balances.reduce((sum, item) => sum + item.balance, 0);

    return balances
      .map((item) => ({
        ...item,
        percentage: totalChartBalance > 0 ? (item.balance / totalChartBalance) * 100 : 0,
      }))
      .sort((a, b) => b.balance - a.balance);
  }, [filteredAssets]);

  const chartColors: Record<AssetType, string> = {
    savings: '#3B82F6',
    stock: '#10B981',
    property: '#8B5CF6',
    gold: '#F59E0B',
    loan: '#EF4444',
  };

  const chartData = useMemo(() => {
    if (typeData.length === 0) {
      return {
        labels: ['자산 없음'],
        datasets: [
          {
            data: [1],
            backgroundColor: ['#E2E8F0'],
            borderWidth: 0,
          },
        ],
      };
    }

    return {
      labels: typeData.map((item) => ASSET_TYPE_CONFIG[item.type].label),
      datasets: [
        {
          data: typeData.map((item) => Math.abs(item.balance)),
          backgroundColor: typeData.map((item) => chartColors[item.type]),
          borderWidth: 0,
          cutout: '65%',
        },
      ],
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
          label(context: any) {
            const value = context.raw as number;
            const item = typeData[context.dataIndex];
            const totalChartBalance = typeData.reduce((sum, typeItem) => sum + typeItem.balance, 0);
            const percentage = totalChartBalance > 0 ? ((value / totalChartBalance) * 100).toFixed(1) : 0;
            return `${item.balance.toLocaleString()}원 (${percentage}%)`;
          },
        },
      },
    },
  };

  const isPositive = dailyChange > 0;

  return (
    <div className="overflow-visible rounded-2xl border border-slate-100 bg-white shadow-sm">
      <div className="px-5 pb-8 pt-5">
        <p className="mb-1 text-sm text-slate-500">현재 총자산</p>
        <p className="text-2xl font-bold tracking-tight text-slate-900">
          {totalBalance.toLocaleString()}
          <span className="ml-1 text-base font-medium text-slate-400">원</span>
        </p>
        <p className="mt-0.5 text-sm text-slate-400">({formatKoreanUnit(totalBalance)}원)</p>
        {dailyChange !== 0 && (
          <p className={`mt-1 text-sm ${isPositive ? 'text-red-500' : 'text-blue-500'}`}>
            {isPositive ? '+' : ''}
            {changeRate.toFixed(2)}% ({Math.abs(dailyChange).toLocaleString()}원)
          </p>
        )}
      </div>

      <div className="flex gap-6 px-5">
        {memberOptions.map((member) => (
          <button
            key={member}
            onClick={() => onMemberChange(member)}
            className={`relative pb-2 text-sm font-medium transition-all ${
              selectedMember === member ? 'text-blue-500' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            {member}
            {selectedMember === member && (
              <div className="absolute bottom-0 left-1/2 h-0.5 w-full -translate-x-1/2 rounded-full bg-blue-500" />
            )}
          </button>
        ))}
      </div>

      <div className="mx-5 border-t border-slate-100" />

      <div className="p-5">
        <div className="flex items-center">
          <div className="-m-[10px] h-[140px] w-[140px] flex-shrink-0">
            <Doughnut data={chartData} options={chartOptions} />
          </div>

          <div className="ml-6 flex-1 space-y-2.5">
            {typeData.map((item) => {
              const config = ASSET_TYPE_CONFIG[item.type];
              return (
                <div key={item.type} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: chartColors[item.type] }}
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
    </div>
  );
}
