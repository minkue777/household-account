'use client';

import { useMemo, useState } from 'react';
import type { ChartOptions, TooltipItem } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { AssetHistoryEntry } from '@/types/asset';

type ProfitViewType = 'monthly' | 'daily';

interface AssetProfitChartProps {
  totalSnapshots: AssetHistoryEntry[];
  totalAssets: number;
}

type ProfitRow = {
  label: string;
  profit: number;
  rate: number;
};

function formatSignedAmount(value: number) {
  const prefix = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${prefix}${Math.abs(value).toLocaleString()}원`;
}

function formatSignedRate(value: number) {
  const prefix = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${prefix}${Math.abs(value).toFixed(2)}%`;
}

export default function AssetProfitChart({
  totalSnapshots,
  totalAssets,
}: AssetProfitChartProps) {
  const today = new Date();
  const [profitView, setProfitView] = useState<ProfitViewType>('daily');
  const [profitYear, setProfitYear] = useState(today.getFullYear());
  const [profitMonth, setProfitMonth] = useState(today.getMonth() + 1);
  const [showProfitTable, setShowProfitTable] = useState(false);

  const monthlyProfitData = useMemo(() => {
    const monthlyData: { month: number; profit: number; rate: number }[] = [];

    for (let month = 1; month <= 12; month += 1) {
      const startDate = `${profitYear}-${String(month).padStart(2, '0')}-01`;
      const endDate = `${profitYear}-${String(month).padStart(2, '0')}-31`;

      const monthSnapshots = totalSnapshots.filter(
        (history) => history.date >= startDate && history.date <= endDate
      );

      const totalChange = monthSnapshots.reduce(
        (sum, history) => sum + history.changeAmount,
        0
      );

      const firstEntry = monthSnapshots[0];
      const baseAmount = firstEntry
        ? firstEntry.balance - firstEntry.changeAmount
        : totalAssets;
      const rate = baseAmount > 0 ? (totalChange / baseAmount) * 100 : 0;

      monthlyData.push({
        month,
        profit: totalChange,
        rate,
      });
    }

    return monthlyData;
  }, [profitYear, totalAssets, totalSnapshots]);

  const dailyProfitData = useMemo(() => {
    const daysInMonth = new Date(profitYear, profitMonth, 0).getDate();
    const dailyData: { day: number; profit: number; rate: number }[] = [];

    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateStr = `${profitYear}-${String(profitMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const daySnapshot = totalSnapshots.find((history) => history.date === dateStr);

      const profit = daySnapshot?.changeAmount || 0;
      const baseAmount = daySnapshot ? daySnapshot.balance - daySnapshot.changeAmount : 0;
      const rate = baseAmount > 0 ? (profit / baseAmount) * 100 : 0;

      dailyData.push({
        day,
        profit,
        rate,
      });
    }

    return dailyData;
  }, [profitMonth, profitYear, totalSnapshots]);

  const profitChartData = useMemo(() => {
    if (profitView === 'monthly') {
      return {
        labels: monthlyProfitData.map((item) => String(item.month)),
        datasets: [
          {
            data: monthlyProfitData.map((item) => item.profit),
            backgroundColor: monthlyProfitData.map((item) =>
              item.profit >= 0 ? 'rgba(239, 68, 68, 0.82)' : 'rgba(59, 130, 246, 0.82)'
            ),
            borderRadius: 4,
          },
        ],
      };
    }

    return {
      labels: dailyProfitData.map((item) => String(item.day)),
      datasets: [
        {
          data: dailyProfitData.map((item) => item.profit),
          backgroundColor: dailyProfitData.map((item) =>
            item.profit >= 0 ? 'rgba(239, 68, 68, 0.82)' : 'rgba(59, 130, 246, 0.82)'
          ),
          borderRadius: 2,
        },
      ],
    };
  }, [dailyProfitData, monthlyProfitData, profitView]);

  const profitChartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label(context: TooltipItem<'bar'>) {
            const value = Number(context.raw ?? 0);
            return formatSignedAmount(value);
          },
        },
      },
    },
    scales: {
      x: {
        grid: {
          display: false,
        },
        ticks: {
          maxRotation: 0,
          minRotation: 0,
          font: { size: 11 },
          color: '#94a3b8',
        },
      },
      y: {
        grid: {
          color: 'rgba(15, 23, 42, 0.05)',
        },
        title: {
          display: true,
          text: '(백만)',
          font: { size: 11 },
          color: '#94a3b8',
        },
        ticks: {
          callback(value: number | string) {
            const numericValue = Number(value);
            if (Math.abs(numericValue) >= 1000000) {
              return (numericValue / 1000000).toFixed(1);
            }
            if (Math.abs(numericValue) >= 10000) {
              return (numericValue / 1000000).toFixed(2);
            }
            return numericValue;
          },
        },
      },
    },
  };

  const profitTableData = useMemo<ProfitRow[]>(() => {
    if (profitView === 'monthly') {
      return monthlyProfitData
        .filter((item) => item.profit !== 0)
        .sort((left, right) => right.month - left.month)
        .map((item) => ({
          label: `${item.month}월`,
          profit: item.profit,
          rate: item.rate,
        }));
    }

    return dailyProfitData
      .filter((item) => item.profit !== 0)
      .sort((left, right) => right.day - left.day)
      .map((item) => ({
        label: `${item.day}일`,
        profit: item.profit,
        rate: item.rate,
      }));
  }, [dailyProfitData, monthlyProfitData, profitView]);

  const currentPeriodLabel =
    profitView === 'monthly'
      ? `${profitYear}년`
      : `${profitYear}년 ${profitMonth}월`;

  const tableTitle = profitView === 'monthly' ? '월별 평가수익' : '일별 평가수익';

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-[14px] shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">수익 차트</h3>
        <div className="flex rounded-lg bg-slate-100 p-0.5">
          <button
            onClick={() => setProfitView('monthly')}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
              profitView === 'monthly'
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500'
            }`}
          >
            월별
          </button>
          <button
            onClick={() => setProfitView('daily')}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
              profitView === 'daily'
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500'
            }`}
          >
            일별
          </button>
        </div>
      </div>

      <div className="mb-4 flex items-center justify-center gap-4">
        <button
          onClick={() => {
            if (profitView === 'monthly') {
              setProfitYear((year) => year - 1);
              return;
            }

            if (profitMonth === 1) {
              setProfitYear((year) => year - 1);
              setProfitMonth(12);
            } else {
              setProfitMonth((month) => month - 1);
            }
          }}
          className="rounded-lg p-1 transition-colors hover:bg-slate-100"
        >
          <ChevronLeft className="h-5 w-5 text-slate-500" />
        </button>
        <span className="min-w-[100px] text-center text-sm font-medium text-slate-700">
          {currentPeriodLabel}
        </span>
        <button
          onClick={() => {
            if (profitView === 'monthly') {
              setProfitYear((year) => year + 1);
              return;
            }

            if (profitMonth === 12) {
              setProfitYear((year) => year + 1);
              setProfitMonth(1);
            } else {
              setProfitMonth((month) => month + 1);
            }
          }}
          className="rounded-lg p-1 transition-colors hover:bg-slate-100"
        >
          <ChevronRight className="h-5 w-5 text-slate-500" />
        </button>
      </div>

      <div className="mb-3 h-[180px]">
        <Bar data={profitChartData} options={profitChartOptions} />
      </div>

      <div>
        <button
          onClick={() => setShowProfitTable((prev) => !prev)}
          className="flex w-full items-center justify-between py-1.5 text-sm font-medium text-slate-600 transition-colors hover:text-slate-800"
        >
          <span>{tableTitle}</span>
          {showProfitTable ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>

        {showProfitTable && (
          <>
            {profitTableData.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-400">
                변동 내역이 없습니다
              </p>
            ) : (
              <div className="tabular-nums">
                <div className="flex items-center border-b border-slate-100 pb-1 text-[12px] font-medium tracking-[-0.01em] text-slate-400">
                  <span className="w-11 shrink-0">일</span>
                  <span className="ml-auto w-[58px] shrink-0 text-right">수익률</span>
                  <span className="ml-7 w-[108px] shrink-0 text-right">수익</span>
                </div>

                <div className="space-y-0 pt-1">
                  {profitTableData.map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center py-[5px] text-[13px] leading-[19px] tracking-[-0.01em]"
                    >
                      <span
                        className="w-11 shrink-0 tracking-[-0.02em] text-slate-700"
                        style={{ fontVariantNumeric: 'normal' }}
                      >
                        {item.label}
                      </span>
                      <span
                        className={`ml-auto w-[58px] shrink-0 text-right font-medium ${
                          item.profit >= 0 ? 'text-red-500' : 'text-blue-500'
                        }`}
                      >
                        {formatSignedRate(item.rate)}
                      </span>
                      <span
                        className={`ml-7 w-[108px] shrink-0 text-right font-medium ${
                          item.profit >= 0 ? 'text-red-500' : 'text-blue-500'
                        }`}
                      >
                        {formatSignedAmount(item.profit)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
