'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ChartOptions } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { getSeoulCalendarParts, getTodayLocalDate, formatLocalDate } from '@/lib/utils/date';
import { useHousehold } from '@/contexts/HouseholdContext';
import { readAssetStatisticsHistory } from '@/platform/reporting/assetStatisticsReadModel';
import type { AssetHistoryEntry } from '@/types/asset';

function formatSignedAmount(value: number) {
  const prefix = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${prefix}${Math.abs(value).toLocaleString()}원`;
}

function formatSignedRate(value: number | undefined) {
  if (value === undefined) return '—';
  const prefix = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${prefix}${Math.abs(value).toFixed(2)}%`;
}

export default function AssetProfitChart({ snapshotId = 'TOTAL', currentBalance, sourceHistory }: {
  snapshotId?: string;
  currentBalance?: number;
  sourceHistory?: readonly AssetHistoryEntry[];
}) {
  const today = getSeoulCalendarParts();
  const { householdKey, isSessionVerified, remoteReadEpoch = 0 } = useHousehold();
  const [view, setView] = useState<'monthly' | 'daily'>('daily');
  const [year, setYear] = useState(today.year);
  const [month, setMonth] = useState(today.month);
  const [history, setHistory] = useState<AssetHistoryEntry[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [revision, setRevision] = useState(0);
  const [showProfitTable, setShowProfitTable] = useState(false);
  const range = useMemo(() => ({
    start: formatLocalDate(new Date(year, view === 'monthly' ? 0 : month - 1, 1)),
    end: formatLocalDate(new Date(year, view === 'monthly' ? 12 : month, 0)),
  }), [year, month, view]);
  useEffect(() => {
    // The statistics page supplies its complete read so chart controls stay local.
    if (sourceHistory !== undefined) return;
    let active = true;
    setHistory([]); setStatus('loading');
    if (!householdKey || !isSessionVerified) return;
    void readAssetStatisticsHistory(range.start, range.end).then(rows => {
      if (active) { setHistory(rows.filter(entry => entry.assetId === snapshotId)); setStatus('ready'); }
    }, () => { if (active) setStatus('failed'); });
    return () => { active = false; };
  }, [householdKey, isSessionVerified, remoteReadEpoch, range.start, range.end, snapshotId, revision, sourceHistory]);
  const chartHistory = useMemo(() => sourceHistory === undefined ? history : sourceHistory.filter(
    entry => entry.assetId === snapshotId && entry.date <= range.end,
  ), [sourceHistory, history, snapshotId, range.end]);
  const displayStatus = sourceHistory === undefined ? status : householdKey && isSessionVerified ? 'ready' : 'loading';
  const currentDate = getTodayLocalDate();
  const displayHistory = useMemo(() => {
    if (currentBalance === undefined || currentDate < range.start || currentDate > range.end) return chartHistory;
    const previous = chartHistory.filter(entry => entry.date < currentDate).at(-1);
    const todayEntry = chartHistory.find(entry => entry.date === currentDate);
    const baseline = previous?.balance ?? (todayEntry ? todayEntry.balance - todayEntry.changeAmount : undefined);
    // This display point comes from a confirmed asset read and is never saved.
    const current: AssetHistoryEntry = {
      id: `realtime_${snapshotId}_${currentDate}`, householdId: householdKey ?? '', assetId: snapshotId,
      date: currentDate, balance: currentBalance, changeAmount: baseline === undefined ? 0 : currentBalance - baseline,
      createdAt: new Date(0),
    };
    return [...chartHistory.filter(entry => entry.date !== currentDate), current].sort((a, b) => a.date.localeCompare(b.date));
  }, [currentBalance, currentDate, range.start, range.end, chartHistory, householdKey, snapshotId]);
  const rows = useMemo(() => {
    const count = view === 'monthly' ? 12 : new Date(year, month, 0).getDate();
    return Array.from({ length: count }, (_, index) => {
      const start = formatLocalDate(new Date(year, view === 'monthly' ? index : month - 1, view === 'monthly' ? 1 : index + 1));
      const end = view === 'monthly' ? formatLocalDate(new Date(year, index + 1, 0)) : start;
      const within = displayHistory.filter(entry => entry.date >= start && entry.date <= end);
      const baseline = displayHistory.filter(entry => entry.date < start).at(-1);
      const last = within.at(-1);
      // Missing observations remain NoData; an observed zero change is valid.
      const change = last ? within.reduce((sum, entry) => sum + entry.changeAmount, 0) : null;
      const base = baseline?.balance ?? (within[0] ? within[0].balance - within[0].changeAmount : undefined);
      return { label: (index + 1) + (view === 'monthly' ? '월' : '일'), change, rate: change !== null && base !== undefined && base !== 0 ? change / Math.abs(base) * 100 : undefined };
    });
  }, [displayHistory, view, year, month]);
  const move = (offset: number) => {
    if (view === 'monthly') setYear(value => value + offset);
    else { const value = new Date(year, month - 1 + offset, 1); setYear(value.getFullYear()); setMonth(value.getMonth() + 1); }
  };
  const chartData = {
    labels: rows.map((_, index) => String(index + 1)),
    datasets: [{
      data: rows.map(row => row.change),
      backgroundColor: rows.map(row => (row.change ?? 0) < 0 ? 'rgba(59, 130, 246, 0.82)' : 'rgba(239, 68, 68, 0.82)'),
      borderRadius: view === 'monthly' ? 4 : 2,
    }],
  };
  const chartOptions: ChartOptions<'bar'> = {
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
  };
  const tableRows = rows.filter(row => row.change !== null).reverse();

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

      {displayStatus === 'loading' ? (
        <p role="status" className="py-8 text-center text-sm text-slate-400">변동 내역을 불러오는 중...</p>
      ) : displayStatus === 'failed' ? (
        <p role="alert" className="py-4 text-sm text-slate-500">
          변동 내역을 불러오지 못했습니다.
          <button type="button" className="ml-2 underline" onClick={() => setRevision(value => value + 1)}>다시 시도</button>
        </p>
      ) : tableRows.length === 0 ? (
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
        {showProfitTable && (
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
        )}
      </>}
    </section>
  );
}
