'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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

interface TooltipState {
  visible: boolean;
  left: number;
  top: number;
  title: string;
  value: string;
  color: string;
}

export default function AssetSummaryCard({
  assets,
  dailyChange,
  previousMonthTotal,
  selectedMember,
  memberOptions,
  onMemberChange,
}: AssetSummaryCardProps) {
  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const [tooltipState, setTooltipState] = useState<TooltipState>({
    visible: false,
    left: 0,
    top: 0,
    title: '',
    value: '',
    color: '#000000',
  });

  useEffect(() => {
    if (!tooltipState.visible) {
      return;
    }

    const hideTooltip = () => {
      setTooltipState((prev) => (prev.visible ? { ...prev, visible: false } : prev));
    };

    window.addEventListener('scroll', hideTooltip, true);
    window.addEventListener('resize', hideTooltip);
    window.addEventListener('touchmove', hideTooltip, { passive: true });

    return () => {
      window.removeEventListener('scroll', hideTooltip, true);
      window.removeEventListener('resize', hideTooltip);
      window.removeEventListener('touchmove', hideTooltip);
    };
  }, [tooltipState.visible]);

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
    const securedLoanSubTypes = new Set(['주택담보대출', '전세대출']);
    const totalPropertyLinkedLoanBalance = filteredAssets
      .filter((asset) => asset.type === 'loan' && securedLoanSubTypes.has(asset.subType || ''))
      .reduce((sum, asset) => sum + Math.abs(asset.currentBalance || 0), 0);

    (Object.keys(ASSET_TYPE_CONFIG) as AssetType[]).forEach((type) => {
      if (type === 'loan') {
        return;
      }

      const baseBalance = filteredAssets
        .filter((asset) => asset.type === type)
        .reduce((sum, asset) => sum + Math.abs(getAssetSignedBalance(asset)), 0);

      const balance =
        type === 'property' ? Math.max(0, baseBalance - totalPropertyLinkedLoanBalance) : baseBalance;

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
    crypto: '#F97316',
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
          data: typeData.map((item) => item.balance),
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
    layout: {
      padding: 10,
    },
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        enabled: false,
        external: (context: any) => {
          const tooltip = context.tooltip;
          const chart = context.chart;

          if (!chartWrapRef.current) {
            return;
          }

          if (!tooltip || tooltip.opacity === 0 || !tooltip.dataPoints?.length) {
            setTooltipState((prev) => (prev.visible ? { ...prev, visible: false } : prev));
            return;
          }

          const dataPoint = tooltip.dataPoints[0];
          const item = typeData[dataPoint.dataIndex];
          if (!item) {
            return;
          }

          const chartRect = chart.canvas.getBoundingClientRect();
          const tooltipHalfWidth = 110;
          const viewportPadding = 12;
          const desiredLeft = chartRect.left + tooltip.caretX;
          const desiredTop = chartRect.top + tooltip.caretY - 16;
          const clampedLeft = Math.min(
            Math.max(desiredLeft, tooltipHalfWidth + viewportPadding),
            window.innerWidth - tooltipHalfWidth - viewportPadding
          );
          const clampedTop = Math.max(desiredTop, 56);

          setTooltipState({
            visible: true,
            left: clampedLeft,
            top: clampedTop,
            title: ASSET_TYPE_CONFIG[item.type].label,
            value: `${item.balance.toLocaleString()}원 (${item.percentage.toFixed(1)}%)`,
            color: chartColors[item.type],
          });
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
          <div ref={chartWrapRef} className="relative -m-[10px] h-[140px] w-[140px] flex-shrink-0 overflow-visible">
            <Doughnut data={chartData} options={chartOptions} />
            {tooltipState.visible && (
              <div
                className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg"
                style={{
                  left: tooltipState.left,
                  top: tooltipState.top,
                }}
              >
                <div className="flex items-center gap-1.5 font-semibold">
                  <span
                    className="h-2 w-2 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: tooltipState.color }}
                  />
                  <span>{tooltipState.title}</span>
                </div>
                <div className="mt-0.5 whitespace-nowrap text-slate-100">{tooltipState.value}</div>
              </div>
            )}
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
                  <span className="text-sm font-medium text-slate-800">{item.percentage.toFixed(1)}%</span>
                </div>
              );
            })}
            {typeData.length === 0 && <p className="text-sm text-slate-400">등록된 자산이 없습니다</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
