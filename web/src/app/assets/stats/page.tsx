'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Chart as ChartJS,
  type ChartData,
  type ChartOptions,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { ArrowLeft } from 'lucide-react';
import { ASSET_TYPE_CONFIG, type Asset, type AssetHistoryEntry, type AssetType } from '@/types/asset';
import { subscribeToAssets } from '@/lib/assetService';
import { useTheme } from '@/contexts/ThemeContext';
import { useHousehold } from '@/contexts/HouseholdContext';
import AssetProfitChart from '@/components/assets/AssetProfitChart';
import AssetDividendChart from '@/components/assets/AssetDividendChart';
import { getTodayLocalDate } from '@/lib/utils/date';
import { peekAssetStatisticsHistory, readAssetStatisticsHistory } from '@/platform/reporting/assetStatisticsReadModel';
import { resolveAssetStatisticsPeriod } from '@/features/reporting/statisticsPeriod';
import { withCurrentAssetBalance, type AssetBalancePoint } from '@/features/reporting/assetBalanceHistory';
import { sumSignedAssetBalances, sumSignedBalancesByAssetType } from '@/lib/assets/assetMath';
import { getClientSessionScope } from '@/composition/clientSessionScope';
import { assetStatisticsSessionKey, subscribeAssetStatisticsInvalidation } from '@/platform/reporting/assetStatisticsQueryCache';
import { useChartMotion } from '@/components/common/useChartMotion';
import { ANDROID_NATIVE_RESUME_EVENT } from '@/platform/android-host/androidLifecycleEvents';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

type PeriodType = '3M' | '6M' | '1Y' | 'ALL';
type TrendSeriesKey = 'all' | AssetType;

const EMPTY_ASSETS: Asset[] = [];
const ASSET_TYPE_ORDER: AssetType[] = ['savings', 'stock', 'crypto', 'property', 'gold', 'loan'];

function formatKoreanUnit(value: number): string {
  if (value === 0) {
    return '0';
  }

  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const eok = Math.floor(abs / 100000000);
  const man = Math.floor((abs % 100000000) / 10000);
  const rest = abs % 10000;
  const parts: string[] = [];

  if (eok > 0) parts.push(`${eok}억`);
  if (man > 0) parts.push(`${man}만`);
  if (rest > 0) parts.push(String(rest));

  return `${sign}${parts.join(' ')}`;
}

function buildCarriedSeries(
  dates: string[],
  entries: readonly AssetBalancePoint[],
  fallbackValue?: number
): Array<number | null> {
  if (entries.length === 0) {
    return dates.map((_, index) => (
      index === dates.length - 1 && fallbackValue !== undefined ? fallbackValue : null
    ));
  }

  const balanceByDate = new Map(entries.map((entry) => [entry.date, entry.balance]));
  let lastValue: number | null = null;

  return dates.map((date) => {
    const value = balanceByDate.get(date);

    if (value !== undefined) {
      lastValue = value;
    }

    return lastValue;
  });
}

function selectHistoryPeriod(
  history: readonly AssetBalancePoint[],
  startDate: string | undefined,
  endDate: string
): AssetBalancePoint[] {
  let baseline: AssetBalancePoint | undefined;
  const points: AssetBalancePoint[] = [];
  for (const point of history) {
    if (startDate && point.date < startDate) baseline = point;
    else if (point.date <= endDate) points.push(point);
  }
  if (baseline && startDate && points[0]?.date !== startDate) {
    points.unshift({ ...baseline, date: startDate, changeAmount: 0 });
  }
  return points;
}

function areSameActiveElements(
  current: Array<{ datasetIndex: number; index: number }>,
  next: Array<{ datasetIndex: number; index: number }>
) {
  if (current.length !== next.length) {
    return false;
  }

  return current.every((element, index) => (
    element.datasetIndex === next[index]?.datasetIndex &&
    element.index === next[index]?.index
  ));
}

export default function AssetStatsPage() {
  const chartMotion = useChartMotion();
  const { themeConfig } = useTheme();
  const {
    householdKey,
    isSessionVerified,
    remoteReadEpoch = 0,
    currentMember,
  } = useHousehold();
  const [assetRead, setAssetRead] = useState<{ key: string; assets?: Asset[]; failed: boolean }>({ key: '', failed: false });
  const [historyRead, setHistoryRead] = useState<{ key: string; history?: AssetHistoryEntry[]; failed: boolean }>({ key: '', failed: false });
  const [revision, setRevision] = useState(0);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const pendingHistoryRead = useRef<{ key: string } | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodType>('3M');
  const [financialOnly, setFinancialOnly] = useState(false);
  const [enabledSeries, setEnabledSeries] = useState<Set<TrendSeriesKey>>(new Set<TrendSeriesKey>(['all']));
  const trendChartRef = useRef<ChartJS<'line', Array<number | null>, string> | null>(null);
  const selectedPeriodRange = useMemo(() => resolveAssetStatisticsPeriod(selectedPeriod), [selectedPeriod]);
  const sessionScope = getClientSessionScope();
  const actorKey = sessionScope ? assetStatisticsSessionKey(sessionScope) : null;
  const canRead = isSessionVerified && !!householdKey && sessionScope?.householdId === householdKey
    && (sessionScope.accessMode === 'administrator-readonly' || sessionScope.memberId === currentMember?.id);
  const sourceKey = JSON.stringify([actorKey, householdKey, currentMember?.id, remoteReadEpoch, selectedPeriodRange.endDate]);
  const cachedHistory = useMemo(() => canRead ? peekAssetStatisticsHistory(selectedPeriodRange.endDate, { cacheEpoch: remoteReadEpoch }) : undefined,
    [canRead, sourceKey, remoteReadEpoch, selectedPeriodRange.endDate, revision]);
  const currentAssetRead = assetRead.key === sourceKey ? assetRead : undefined;
  const assets = currentAssetRead?.assets ?? EMPTY_ASSETS;
  const hasCurrentAssets = currentAssetRead?.assets !== undefined;
  const assetReadFailed = currentAssetRead?.failed ?? false;
  const currentHistoryRead = historyRead.key === sourceKey ? historyRead : undefined;
  const completeHistory = currentHistoryRead?.history ?? cachedHistory;
  const allHistory = completeHistory ?? [];
  const isCurrentSource = canRead && completeHistory !== undefined;
  const failed = canRead && (currentHistoryRead?.failed ?? false);

  useEffect(() => subscribeAssetStatisticsInvalidation(() => setRevision(value => value + 1)), []);

  useEffect(() => {
    let active = true;
    setAssetRead(previous => previous.key === sourceKey
      ? { ...previous, failed: false } : { key: sourceKey, failed: false });
    if (!canRead) return undefined;

    try {
      // A projection's initial empty list or a failed subscription is not an
      // observed zero balance. Only confirmed source snapshots replace history.
      const unsubscribe = subscribeToAssets(() => {}, undefined, (nextAssets, metadata) => {
        if (active && !metadata.fromCache) {
          setAssetRead(previous => {
            const unchanged = previous.key === sourceKey && JSON.stringify(previous.assets) === JSON.stringify(nextAssets);
            if (unchanged && !previous.failed) return previous;
            return { key: sourceKey, assets: unchanged ? previous.assets : [...nextAssets], failed: false };
          });
        }
      }, () => { if (active) setAssetRead(previous => ({ ...previous, failed: true })); });
      return () => { active = false; unsubscribe(); };
    } catch (error) {
      setAssetRead(previous => ({ ...previous, failed: true }));
      console.error('자산 통계의 자산 목록을 불러오지 못했습니다.', error);
      return undefined;
    }
  }, [canRead, sourceKey, revision]);

  useEffect(() => {
    if (!canRead) return;
    let active = true;
    const request = { key: sourceKey };
    pendingHistoryRead.current = request;
    setHistoryRead(previous => ({ key: sourceKey,
      history: previous.key === sourceKey ? previous.history ?? cachedHistory : cachedHistory,
      failed: false }));

    const fetchHistory = async () => {
      try {
        // Re-entry/resume keeps the complete chart visible while verifying it.
        // Period buttons only select this source; they never restart the read.
        const historyData = await readAssetStatisticsHistory(selectedPeriodRange.endDate, {
          cacheEpoch: remoteReadEpoch,
        });
        if (active) setHistoryRead(previous => ({ key: sourceKey,
          history: previous.key === sourceKey && JSON.stringify(previous.history) === JSON.stringify(historyData)
            ? previous.history : historyData,
          failed: false }));
      } catch (error) {
        if (active) setHistoryRead(previous => ({ ...previous, failed: true }));
        console.error('자산 통계 이력을 불러오지 못했습니다.', error);
      } finally {
        if (pendingHistoryRead.current === request) pendingHistoryRead.current = null;
      }
    };

    void fetchHistory();
    return () => { active = false; };
  }, [canRead, remoteReadEpoch, selectedPeriodRange.endDate, sourceKey, cachedHistory, refreshRevision, revision]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible' && pendingHistoryRead.current?.key !== sourceKey) {
        setRefreshRevision(value => value + 1);
      }
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    window.addEventListener('online', refresh);
    window.addEventListener(ANDROID_NATIVE_RESUME_EVENT, refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
      window.removeEventListener('online', refresh);
      window.removeEventListener(ANDROID_NATIVE_RESUME_EVENT, refresh);
    };
  }, [sourceKey]);

  const activeAssets = useMemo(() => assets.filter((asset) => asset.isActive), [assets]);
  const visibleAssets = useMemo(
    () => activeAssets.filter((asset) => !financialOnly || (asset.type !== 'property' && asset.type !== 'loan')),
    [activeAssets, financialOnly]
  );
  const today = getTodayLocalDate();
  const snapshotType = financialOnly ? 'FINANCIAL' : 'TOTAL';
  const historyBySeries = useMemo(() => {
    const grouped = new Map<string, AssetBalancePoint[]>();
    for (const entry of allHistory) {
      const points = grouped.get(entry.assetId);
      if (points) points.push(entry);
      else grouped.set(entry.assetId, [entry]);
    }
    return grouped;
  }, [allHistory]);
  const latestRecordedTotal = historyBySeries.get(snapshotType)?.at(-1)?.balance;
  const totalAssets = hasCurrentAssets ? sumSignedAssetBalances(visibleAssets) : latestRecordedTotal;
  const typeTotals = useMemo(() => sumSignedBalancesByAssetType(visibleAssets), [visibleAssets]);
  const totalHistory = useMemo(() => withCurrentAssetBalance(
    historyBySeries.get(snapshotType) ?? [], hasCurrentAssets ? totalAssets : undefined, today,
  ), [historyBySeries, snapshotType, hasCurrentAssets, totalAssets, today]);
  const series = useMemo(() => {
    const availableTypes = ASSET_TYPE_ORDER.filter(type => (
      (!financialOnly || (type !== 'property' && type !== 'loan'))
      && (visibleAssets.some(asset => asset.type === type)
        || historyBySeries.get(`TYPE_${type}`)?.some(entry => entry.date <= selectedPeriodRange.endDate))
    ));
    const definitions = [
      { key: 'all' as const, snapshotId: snapshotType, label: financialOnly ? '금융자산' : '전체',
        color: '#3B82F6', balance: totalAssets },
      ...availableTypes.map(type => ({ key: type, snapshotId: `TYPE_${type}`,
        label: ASSET_TYPE_CONFIG[type].label, color: ASSET_TYPE_CONFIG[type].color, balance: typeTotals[type] })),
    ];
    return definitions.map(({ snapshotId, ...definition }) => ({
      ...definition,
      history: definition.key === 'all' ? totalHistory
        : withCurrentAssetBalance(historyBySeries.get(snapshotId) ?? [], hasCurrentAssets ? definition.balance : undefined, today),
    }));
  }, [historyBySeries, financialOnly, hasCurrentAssets, selectedPeriodRange.endDate, snapshotType, today, totalAssets, totalHistory, typeTotals, visibleAssets]);

  useEffect(() => {
    const allowedKeys = new Set(series.map(item => item.key));
    setEnabledSeries(previous => {
      const next = new Set(Array.from(previous).filter(key => allowedKeys.has(key)));
      if (next.size === 0) return new Set<TrendSeriesKey>(['all']);
      return next.size === previous.size ? previous : next;
    });
  }, [series]);

  const periodSeries = useMemo(() => series.map(item => ({
    ...item, points: selectHistoryPeriod(item.history, selectedPeriodRange.startDate, selectedPeriodRange.endDate),
  })), [series, selectedPeriodRange.startDate, selectedPeriodRange.endDate]);
  const selectedSeries = useMemo(() => periodSeries.filter(item => enabledSeries.has(item.key)), [periodSeries, enabledSeries]);
  const periodTotals = periodSeries[0].points;
  const chartDates = useMemo(() => {
    const dates = new Set<string>();
    for (const item of selectedSeries) {
      for (const point of item.points) dates.add(point.date);
    }
    return dates.size ? Array.from(dates).sort() : [today];
  }, [selectedSeries, today]);

  const chartData = useMemo<ChartData<'line', Array<number | null>, string>>(() => ({
    labels: chartDates.map(date => {
      const [, month, day] = date.split('-').map(Number);
      return `${month}/${day}`;
    }),
    datasets: selectedSeries.map(item => {
      const isTotal = item.key === 'all';
      return {
        label: item.label,
        data: buildCarriedSeries(chartDates, item.points, item.balance),
        borderColor: item.color,
        backgroundColor: isTotal ? 'rgba(59, 130, 246, 0.10)' : `${item.color}20`,
        borderWidth: isTotal ? 2 : 1.75,
        fill: isTotal,
        tension: 0.3,
        cubicInterpolationMode: 'monotone',
        spanGaps: true,
        pointRadius: chartDates.length > 14 ? 0 : (isTotal ? 2.5 : 2),
        pointHoverRadius: 4,
      };
    }),
  }), [chartDates, selectedSeries]);

  const chartOptions = useMemo<ChartOptions<'line'>>(
    () => ({
      ...chartMotion,
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      onClick: (event, elements, chart) => {
        if (elements.length > 0) {
          const clickedElements = elements.map(({ datasetIndex, index }) => ({ datasetIndex, index }));
          const activeElements = chart.getActiveElements().map(({ datasetIndex, index }) => ({ datasetIndex, index }));

          if (areSameActiveElements(activeElements, clickedElements)) {
            chart.setActiveElements([]);
            chart.tooltip?.setActiveElements([], { x: 0, y: 0 });
            chart.update();
            return;
          }

          chart.setActiveElements(clickedElements);
          chart.tooltip?.setActiveElements(clickedElements, { x: event.x, y: event.y });
          chart.update();
          return;
        }

        chart.setActiveElements([]);
        chart.tooltip?.setActiveElements([], { x: 0, y: 0 });
        chart.update();
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          callbacks: {
            label(context) {
              if (context.parsed.y === null) {
                return `${context.dataset.label}: 데이터 없음`;
              }

              return `${context.dataset.label}: ${context.parsed.y.toLocaleString()}원`;
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
            maxTicksLimit: 7,
          },
        },
        y: {
          beginAtZero: false,
          grid: {
            color: 'rgba(0, 0, 0, 0.05)',
          },
          title: {
            display: true,
            text: '(억원)',
            font: { size: 11 },
            color: '#94a3b8',
          },
          ticks: {
            callback(value) {
              const numericValue = typeof value === 'number' ? value : Number(value);
              return (numericValue / 100000000).toFixed(1);
            },
          },
        },
      },
      elements: {
        line: {
          borderCapStyle: 'round',
          borderJoinStyle: 'round',
        },
        point: {
          hitRadius: 10,
        },
      },
    }),
    [chartMotion]
  );

  const periodChange = periodTotals.length > 1
    ? periodTotals[periodTotals.length - 1].balance - periodTotals[0].balance
    : 0;

  const periodChangeRate = periodTotals.length > 1 && periodTotals[0].balance > 0
    ? (periodChange / periodTotals[0].balance) * 100
    : 0;

  const toggleSeries = (key: TrendSeriesKey) => {
    setEnabledSeries((prev) => {
      const next = new Set(prev);

      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      if (next.size === 0) {
        next.add('all');
      }

      return next;
    });
  };

  const clearTrendChartSelection = () => {
    const chart = trendChartRef.current;

    if (!chart) {
      return;
    }

    chart.setActiveElements([]);
    chart.tooltip?.setActiveElements([], { x: 0, y: 0 });
    chart.update();
  };

  return (
    <main className="min-h-screen p-4 md:p-6 lg:p-8">
      <div className="mx-auto max-w-lg">
        <header className="mb-4 flex items-center gap-3">
          <Link
            href="/assets"
            aria-label="자산으로 돌아가기"
            className="rounded-xl p-2 transition-colors hover:bg-white/95"
          >
            <ArrowLeft className="h-5 w-5 text-slate-600" />
          </Link>
          <h1
            className="text-lg font-bold md:text-xl"
            style={{
              background: themeConfig.titleGradient,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            자산 통계
          </h1>
        </header>

        <div className="space-y-4">
          {!isCurrentSource && !failed ? (
            <div role="status" className="py-12 text-center text-slate-400">불러오는 중...</div>
          ) : !isCurrentSource ? (
            <div role="alert" className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              자산 통계를 불러오지 못했습니다.
              <button type="button" className="ml-3 underline" onClick={() => setRevision((value) => value + 1)}>다시 시도</button>
            </div>
          ) : (
            <>
              {assetReadFailed && <p role="alert" className="mb-3 text-sm text-red-600">현재 자산을 불러오지 못했습니다. <button onClick={() => setRevision(value => value + 1)} className="underline">다시 시도</button></p>}
              {failed && (
                <p role="alert" className="text-xs text-slate-500">최신 자산 이력을 확인하지 못했습니다. 이전 내역을 표시합니다.
                  <button type="button" className="ml-2 underline" onClick={() => setRefreshRevision(value => value + 1)}>다시 시도</button>
                </p>
              )}
              <div className="relative rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                <button
                  type="button"
                  aria-pressed={financialOnly}
                  onClick={() => setFinancialOnly((prev) => !prev)}
                  className={`absolute right-5 top-5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                    financialOnly
                      ? 'bg-blue-500 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {financialOnly ? '금융자산' : '전체자산'}
                </button>

                <p className="mb-1 text-sm text-slate-500">
                  {financialOnly ? '금융자산' : hasCurrentAssets ? '현재 총 자산' : '마지막 기록 자산'}
                </p>
                {totalAssets === undefined ? <p className="text-sm text-slate-400">데이터가 없습니다</p> : <>
                  <p className="text-2xl font-bold text-slate-900">
                    {totalAssets.toLocaleString()}
                    <span className="ml-1 text-base font-medium text-slate-400">원</span>
                  </p>
                  <p className="mt-0.5 text-sm text-slate-400">
                    ({formatKoreanUnit(totalAssets)}원)
                  </p>
                </>}
                {periodChange !== 0 && (
                  <p className={`mt-1 text-sm ${periodChange > 0 ? 'text-red-500' : 'text-blue-500'}`}>
                    {periodChange > 0 ? '+' : ''}
                    {periodChange.toLocaleString()}원 ({periodChangeRate > 0 ? '+' : ''}
                    {periodChangeRate.toFixed(2)}%)
                  </p>
                )}
              </div>

              <div className="flex gap-2">
                {(['3M', '6M', '1Y', 'ALL'] as PeriodType[]).map((period) => (
                  <button
                    type="button"
                    key={period}
                    aria-pressed={selectedPeriod === period}
                    aria-label={{ '3M': '3개월', '6M': '6개월', '1Y': '1년', ALL: '전체 기간' }[period]}
                    onClick={() => setSelectedPeriod(period)}
                    className={`flex-1 rounded-xl py-2 text-sm font-medium transition-all ${
                      selectedPeriod === period
                        ? 'bg-blue-500 text-white'
                        : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {period === 'ALL' ? '전체' : period}
                  </button>
                ))}
              </div>

              <div
                className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm"
                onClick={clearTrendChartSelection}
              >
                <h3 className="mb-4 text-sm font-semibold text-slate-700">자산 추이</h3>

                <div className="mb-4 flex flex-wrap gap-2">
                  {series.map(item => {
                    const isEnabled = enabledSeries.has(item.key);
                    return (
                      <button
                        type="button"
                        key={item.key}
                        aria-pressed={isEnabled}
                        onClick={() => toggleSeries(item.key)}
                        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-all ${
                          isEnabled ? 'text-white shadow-md' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                        style={{ backgroundColor: isEnabled ? item.color : undefined }}
                      >
                        {item.key !== 'all' && (
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: isEnabled ? 'white' : item.color }} />
                        )}
                        {item.key === 'all' && !financialOnly ? '전체 자산' : item.label}
                      </button>
                    );
                  })}
                </div>

                <div className="h-[280px]" onClick={(event) => event.stopPropagation()}>
                  {chartData.datasets.some((dataset) => dataset.data.some((value) => value !== null)) ? (
                    <Line ref={trendChartRef} data={chartData} options={chartOptions} />
                  ) : (
                    <div className="flex h-full items-center justify-center text-slate-400">
                      표시할 자산 데이터가 없습니다.
                    </div>
                  )}
                </div>
              </div>

              <AssetProfitChart
                key={`profit:${actorKey}:${remoteReadEpoch}`}
                sourceHistory={series[0].history}
              />

            </>
          )}
          {canRead && (
            <AssetDividendChart key={`dividend:${actorKey}:${remoteReadEpoch}`} visible={isCurrentSource} revision={revision} />
          )}
        </div>
      </div>
    </main>
  );
}
