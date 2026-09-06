'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import { getSeoulCalendarParts, formatLocalDate } from '@/lib/utils/date';
import { useHousehold } from '@/contexts/HouseholdContext';
import { readAssetStatisticsHistory } from '@/platform/reporting/assetStatisticsReadModel';
import type { AssetHistoryEntry } from '@/types/asset';

export default function AssetProfitChart({ snapshotId = 'TOTAL' }: { snapshotId?: string }) {
  const today = getSeoulCalendarParts();
  const { householdKey, isSessionVerified, remoteReadEpoch = 0 } = useHousehold();
  const [view, setView] = useState<'monthly' | 'daily'>('daily');
  const [year, setYear] = useState(today.year);
  const [month, setMonth] = useState(today.month);
  const [history, setHistory] = useState<AssetHistoryEntry[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [revision, setRevision] = useState(0);
  const range = useMemo(() => ({
    start: formatLocalDate(new Date(year, view === 'monthly' ? 0 : month - 1, 1)),
    end: formatLocalDate(new Date(year, view === 'monthly' ? 12 : month, 0)),
  }), [year, month, view]);
  useEffect(() => {
    let active = true;
    setHistory([]); setStatus('loading');
    if (!householdKey || !isSessionVerified) return;
    void readAssetStatisticsHistory(range.start, range.end).then(rows => {
      if (active) { setHistory(rows.filter(entry => entry.assetId === snapshotId)); setStatus('ready'); }
    }, () => { if (active) setStatus('failed'); });
    return () => { active = false; };
  }, [householdKey, isSessionVerified, remoteReadEpoch, range.start, range.end, snapshotId, revision]);
  const rows = useMemo(() => {
    const count = view === 'monthly' ? 12 : new Date(year, month, 0).getDate();
    return Array.from({ length: count }, (_, index) => {
      const start = formatLocalDate(new Date(year, view === 'monthly' ? index : month - 1, view === 'monthly' ? 1 : index + 1));
      const end = view === 'monthly' ? formatLocalDate(new Date(year, index + 1, 0)) : start;
      const within = history.filter(entry => entry.date >= start && entry.date <= end);
      const baseline = history.filter(entry => entry.date < start).at(-1);
      const last = within.at(-1);
      // Missing observations remain NoData; an observed zero change is valid.
      const change = last ? within.reduce((sum, entry) => sum + entry.changeAmount, 0) : null;
      const base = baseline?.balance ?? (within[0] ? within[0].balance - within[0].changeAmount : undefined);
      return { label: (index + 1) + (view === 'monthly' ? '월' : '일'), change, rate: change !== null && base !== undefined && base !== 0 ? change / Math.abs(base) * 100 : undefined };
    });
  }, [history, view, year, month]);
  const move = (offset: number) => {
    if (view === 'monthly') setYear(value => value + offset);
    else { const value = new Date(year, month - 1 + offset, 1); setYear(value.getFullYear()); setMonth(value.getMonth() + 1); }
  };
  return <section className="space-y-3 border-t pt-4">
    <h3 className="text-sm font-semibold">자산 변동 차트</h3>
    <div className="flex items-center justify-between gap-2">
      <div><button type="button" aria-pressed={view === 'monthly'} onClick={() => setView('monthly')} className="mr-3">월별</button><button type="button" aria-pressed={view === 'daily'} onClick={() => setView('daily')}>일별</button></div>
      <div><button type="button" aria-label="이전 변동 기간" onClick={() => move(-1)}>‹</button><span className="mx-3">{year}년 {view === 'daily' ? month + '월' : ''}</span><button type="button" aria-label="다음 변동 기간" onClick={() => move(1)}>›</button></div>
    </div>
    {status === 'loading' ? <p>변동 내역을 불러오는 중...</p> : status === 'failed' ? <p role="alert">변동 내역을 불러오지 못했습니다.<button type="button" className="ml-2 underline" onClick={() => setRevision(value => value + 1)}>다시 시도</button></p>
      : rows.every(row => row.change === null) ? <p>변동 데이터가 없습니다</p> : <>
        <div className="h-48"><Bar data={{ labels: rows.map(row => row.label), datasets: [{ data: rows.map(row => row.change), backgroundColor: rows.map(row => (row.change ?? 0) < 0 ? '#3b82f6' : '#ef4444') }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }} /></div>
        <details><summary className="cursor-pointer text-sm">변동 내역</summary><table className="w-full text-right text-xs"><thead><tr><th>기간</th><th>변동률</th><th>변동액</th></tr></thead><tbody>{rows.filter(row => row.change !== null).map(row => <tr key={row.label}><td>{row.label}</td><td>{row.rate === undefined ? '—' : row.rate.toFixed(2) + '%'}</td><td>{row.change!.toLocaleString()}원</td></tr>)}</tbody></table></details>
      </>}
  </section>;
}
