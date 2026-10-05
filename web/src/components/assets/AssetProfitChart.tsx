'use client';

import { memo, useMemo, useState } from 'react';
import type { ChartOptions } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { getSeoulCalendarParts, formatLocalDate } from '@/lib/utils/date';
import type { AssetBalancePoint } from '@/features/reporting/assetBalanceHistory';
import { useChartMotion } from '@/components/common/useChartMotion';

function formatSignedAmount(value: number) {
  const prefix = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${prefix}${Math.abs(value).toLocaleString()}원`;
}

function formatSignedRate(value: number | undefined) {
  if (value === undefined) return '—';
  const prefix = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${prefix}${Math.abs(value).toFixed(2)}%`;
}

function AssetProfitChart({ sourceHistory }: {
  sourceHistory: readonly AssetBalancePoint[];
}) {
  const today = getSeoulCalendarParts();
  const chartMotion = useChartMotion();
  const [view, setView] = useState<'monthly' | 'daily'>('daily');
  const [year, setYear] = useState(today.year);
  const [month, setMonth] = useState(today.month);
  const [showProfitTable, setShowProfitTable] = useState(false);
  const endDate = useMemo(
    () => formatLocalDate(new Date(year, view === 'monthly' ? 12 : month, 0)),
    [year, month, view],
  );
  const displayHistory = useMemo(
    () => sourceHistory.filter(entry => entry.date <= endDate),
    [sourceHistory, endDate],
  );
  const rows = useMemo(() => {
    const count = view === 'monthly' ? 12 : new Date(year, month, 0).getDate();
    let cursor = 0;
    let baseline: AssetBalancePoint | undefined;
    return Array.from({ length: count }, (_, index) => {
      const start = formatLocalDate(new Date(year, view === 'monthly' ? index : month - 1, view === 'monthly' ? 1 : index + 1));
      const end = view === 'monthly' ? formatLocalDate(new Date(year, index + 1, 0)) : start;
      // History and periods are chronological, so consume the source once.
      // Repeated full-history filters made every day scan all earlier years.
      while (cursor < displayHistory.length && displayHistory[cursor].date < start) {
        baseline = displayHistory[cursor++];
      }
      const first = displayHistory[cursor]?.date <= end ? displayHistory[cursor] : undefined;
      const base = baseline?.balance ?? (first ? first.balance - first.changeAmount : undefined);
      let change: number | null = null;
      while (cursor < displayHistory.length && displayHistory[cursor].date <= end) {
        const entry = displayHistory[cursor++];
        change = (change ?? 0) + entry.changeAmount;
        baseline = entry;
      }
      // Missing observations remain NoData; an observed zero change is valid.
      return { label: (index + 1) + (view === 'monthly' ? '월' : '일'), change, rate: change !== null && base !== undefined && base !== 0 ? change / Math.abs(base) * 100 : undefined };
    });
  }, [displayHistory, view, year, month]);
  const move = (offset: number) => {
    if (view === 'monthly') setYear(value => value + offset);
    else { const value = new Date(year, month - 1 + offset, 1); setYear(value.getFullYear()); setMonth(value.getMonth() + 1); }
  };
  const chartData = useMemo(() => ({
    labels: rows.map((_, index) => String(index + 1)),
    datasets: [{
      data: rows.map(row => row.change),
      backgroundColor: rows.map(row => (row.change ?? 0) < 0 ? 'rgba(59, 130, 246, 0.82)' : 'rgba(239, 68, 68, 0.82)'),
      borderRadius: view === 'monthly' ? 4 : 2,
    }],
  }), [rows, view]);
  const chartOptions = useMemo<ChartOptions<'bar'>>(() => ({
    ...chartMotion,
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: context => formatSignedAmount(Number(context.raw ?? 0)) } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { maxRotation: 0, minRotation: 0, font: { size: 11 }, color: '#94a3b8' } },
      y: {
        grid: { color: 'rgba(15, 23, 42, 0.05)' },
        title: { display: true, text: '(백만)', font: { size: 11 }, color: '#94a3b8' },
        ticks: { callback: value => Number((Number(value) / 1000000).toFixed(2)) },
      },
    },
  }), [chartMotion]);
  const tableRows = rows.filter(row => row.change !== null && (view === 'monthly' || row.change !== 0)).reverse();

  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-[14px] shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">자산 변동 차트</h3>
        <div className="flex rounded-lg bg-slate-100 p-0.5">
          {(['monthly', 'daily'] as const).map(value => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => setView(value)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${view === value ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}
            >
              {value === 'monthly' ? '월별' : '일별'}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 flex items-center justify-center gap-4">
        <button type="button" aria-label="이전 변동 기간" onClick={() => move(-1)} className="rounded-lg p-1 transition-colors hover:bg-slate-100">
          <ChevronLeft className="h-5 w-5 text-slate-500" />
        </button>
        <span className="min-w-[100px] text-center text-sm font-medium text-slate-700">
          {year}년{view === 'daily' ? ` ${month}월` : ''}
        </span>
        <button type="button" aria-label="다음 변동 기간" onClick={() => move(1)} className="rounded-lg p-1 transition-colors hover:bg-slate-100">
          <ChevronRight className="h-5 w-5 text-slate-500" />
        </button>
      </div>

      {rows.every(row => row.change === null) ? (
        <p className="py-8 text-center text-sm text-slate-400">변동 데이터가 없습니다</p>
      ) : <>
        <div className="mb-3 h-[180px]"><Bar data={chartData} options={chartOptions} /></div>
        <button
          type="button"
          aria-expanded={showProfitTable}
          onClick={() => setShowProfitTable(value => !value)}
          className="flex w-full items-center justify-between py-1.5 text-sm font-medium text-slate-600 transition-colors hover:text-slate-800"
        >
          <span>{view === 'monthly' ? '월별 자산 변동' : '일별 자산 변동'}</span>
          {showProfitTable ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {showProfitTable && (tableRows.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">변동 내역이 없습니다</p>
        ) : (
          <div className="tabular-nums">
            <div className="flex items-center border-b border-slate-100 pb-1 text-[12px] font-medium tracking-[-0.01em] text-slate-400">
              <span className="w-11 shrink-0">{view === 'monthly' ? '월' : '일'}</span>
              <span className="ml-auto w-[58px] shrink-0 text-right">변동률</span>
              <span className="ml-7 w-[108px] shrink-0 text-right">변동액</span>
            </div>
            <div className="space-y-0 pt-1">
              {tableRows.map(row => (
                <div key={row.label} className="flex items-center py-[5px] text-[13px] leading-[19px] tracking-[-0.01em]">
                  <span className="w-11 shrink-0 tracking-[-0.02em] text-slate-700" style={{ fontVariantNumeric: 'normal' }}>{row.label}</span>
                  <span className={`ml-auto w-[58px] shrink-0 text-right font-medium ${(row.change ?? 0) >= 0 ? 'text-red-500' : 'text-blue-500'}`}>{formatSignedRate(row.rate)}</span>
                  <span className={`ml-7 w-[108px] shrink-0 text-right font-medium ${(row.change ?? 0) >= 0 ? 'text-red-500' : 'text-blue-500'}`}>{formatSignedAmount(row.change!)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </>}
    </section>
  );
}

export default memo(AssetProfitChart);
