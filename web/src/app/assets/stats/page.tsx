'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler, BarElement } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { ASSET_TYPE_CONFIG, type AssetHistoryEntry, type AssetType } from '@/types/asset';
import { useHousehold } from '@/contexts/HouseholdContext';
import { readAssetStatisticsHistory } from '@/platform/reporting/assetStatisticsReadModel';
import { resolveAssetStatisticsPeriod } from '@/features/reporting/statisticsPeriod';
import AssetProfitChart from '@/components/assets/AssetProfitChart';
import AssetDividendChart from '@/components/assets/AssetDividendChart';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler, BarElement);
type Period = '3M' | '6M' | '1Y' | 'ALL';

function labelFor(entry: AssetHistoryEntry) {
  if (entry.assetId.startsWith('OWNER_REF_')) return entry.ownerDisplayName ?? entry.ownerKey ?? entry.assetId;
  const type = entry.assetId.slice(5) as AssetType;
  return ASSET_TYPE_CONFIG[type]?.label ?? type;
}

/** Carry only observed snapshots; no live balance is invented for missing history. */
function carry(entries: AssetHistoryEntry[], start: string | undefined, end: string) {
  if (entries.length === 0) return [];
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const baseline = start ? sorted.filter(entry => entry.date <= start).at(-1) : undefined;
  const points = sorted.filter(entry => !start || entry.date >= start);
  if (baseline && baseline.date < start!) points.unshift({ ...baseline, date: start! });
  if (points.length > 0 && points.at(-1)!.date < end) points.push({ ...points.at(-1)!, date: end, changeAmount: 0 });
  return points;
}

export default function AssetStatsPage() {
  const { householdKey, isSessionVerified, remoteReadEpoch = 0 } = useHousehold();
  const [period, setPeriod] = useState<Period>('3M');
  const [financialOnly, setFinancialOnly] = useState(false);
  const [dimension, setDimension] = useState('all');
  const [history, setHistory] = useState<AssetHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const range = useMemo(() => resolveAssetStatisticsPeriod(period), [period]);

  useEffect(() => {
    let active = true;
    setHistory([]); setFailed(false);
    if (!isSessionVerified || !householdKey) { setLoading(true); return; }
    setLoading(true);
    void readAssetStatisticsHistory(range.startDate, range.endDate)
      .then(rows => { if (active) setHistory(rows); }, () => { if (active) setFailed(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [householdKey, isSessionVerified, remoteReadEpoch, range.startDate, range.endDate, revision]);

  const catalog = useMemo(() => {
    const found = new Map<string, string>();
    history.forEach(entry => {
      if (entry.assetId.startsWith('TYPE_')) {
        const type = entry.assetId.slice(5);
        if (financialOnly && (type === 'property' || type === 'loan')) return;
        found.set(entry.assetId, labelFor(entry));
      }
      // Owner totals are whole-portfolio dimensions. The financial view uses
      // the authoritative financial/type dimensions, never guessed cross totals.
      if (!financialOnly && entry.assetId.startsWith('OWNER_REF_')) found.set(entry.assetId, labelFor(entry));
    });
    return found;
  }, [history, financialOnly]);
  const selected = dimension === 'all' || catalog.has(dimension) ? dimension : 'all';
  useEffect(() => { if (selected !== dimension) setDimension('all'); }, [selected, dimension]);
  const snapshotId = selected === 'all' ? (financialOnly ? 'FINANCIAL' : 'TOTAL') : selected;
  const observed = useMemo(() => history.filter(entry => entry.assetId === snapshotId), [history, snapshotId]);
  const points = useMemo(() => carry(observed, range.startDate, range.endDate), [observed, range.startDate, range.endDate]);
  const latest = observed.at(-1)?.balance;
  const baseline = range.startDate ? observed.filter(entry => entry.date <= range.startDate!).at(-1)?.balance : observed[0]?.balance;
  const change = baseline === undefined || latest === undefined ? undefined : latest - baseline;
  const chart = {
    labels: points.map(entry => entry.date),
    datasets: [{ label: selected === 'all' ? '전체' : catalog.get(selected), data: points.map(entry => entry.balance),
      borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,.08)', fill: true, tension: 0.2, pointRadius: 2 }],
  };
  return <main className="min-h-screen p-4 md:p-6"><div className="mx-auto max-w-4xl space-y-5">
    <header className="flex items-center gap-4"><Link href="/assets" aria-label="자산으로 돌아가기"><ArrowLeft /></Link><h1 className="text-xl font-bold">자산 통계</h1></header>
    <section className="space-y-3 rounded-2xl border bg-white p-4">
      <div className="flex flex-wrap gap-2">{(['3M', '6M', '1Y', 'ALL'] as Period[]).map(value =>
        <button type="button" key={value} aria-pressed={period === value} onClick={() => setPeriod(value)} className={period === value ? 'rounded-lg bg-blue-600 px-3 py-2 text-white' : 'rounded-lg bg-slate-100 px-3 py-2'}>{{ '3M': '3개월', '6M': '6개월', '1Y': '1년', ALL: '전체 기간' }[value]}</button>)}</div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={financialOnly} onChange={event => setFinancialOnly(event.target.checked)} />금융자산만 보기</label>
      {!loading && !failed && <div className="flex flex-wrap gap-2" aria-label="통계 차원">
        <button type="button" aria-pressed={selected === 'all'} onClick={() => setDimension('all')} className="rounded border px-3 py-1">전체</button>
        {Array.from(catalog).map(([key, label]) => <button type="button" key={key} aria-pressed={selected === key} onClick={() => setDimension(key)} className="rounded border px-3 py-1">{label}</button>)}
      </div>}
    </section>
    {loading ? <p role="status">로딩중...</p> : failed ? <div role="alert" className="rounded-2xl border bg-white p-5">자산 통계를 불러오지 못했습니다.<button type="button" className="ml-3 underline" onClick={() => setRevision(value => value + 1)}>다시 시도</button></div>
      : <section className="space-y-4 rounded-2xl border bg-white p-4">
        <h2 className="font-semibold">{selected === 'all' ? (financialOnly ? '금융자산' : '전체 자산') : catalog.get(selected)} 추이</h2>
        {latest === undefined ? <p>데이터가 없습니다</p> : <>
          <p className="text-sm text-slate-500">기간 내 마지막 기록</p><p className="text-2xl font-bold">{latest.toLocaleString()}원</p>
          <p className="text-sm">기간 변동: {change === undefined ? '시작 기준 데이터 없음' : change.toLocaleString() + '원'}</p>
          <div className="h-72"><Line data={chart} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, interaction: { intersect: false, mode: 'index' } }} /></div>
          <AssetProfitChart snapshotId={snapshotId} />
        </>}
      </section>}
    {isSessionVerified && householdKey && <AssetDividendChart key={`${householdKey}:${remoteReadEpoch}`} />}
  </div></main>;
}
