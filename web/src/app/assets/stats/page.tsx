'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Chart as ChartJS,
  type ChartData,
  type ChartDataset,
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
import { Timestamp } from 'firebase/firestore';
import { ArrowLeft } from 'lucide-react';
import { ASSET_TYPE_CONFIG, type Asset, type AssetHistoryEntry, type AssetType } from '@/types/asset';
import {
  getAssetHistoryByPeriod,
  processLoanAutoRepayments,
  processSavingsAutoContributions,
  refreshAllPhysicalGoldValues,
  subscribeToAssets,
} from '@/lib/assetService';
import { useTheme } from '@/contexts/ThemeContext';
import AssetProfitChart from '@/components/assets/AssetProfitChart';
import AssetDividendChart from '@/components/assets/AssetDividendChart';
import { formatLocalDate } from '@/lib/utils/date';
import { sumSignedAssetBalances, sumSignedBalancesByAssetType } from '@/lib/assets/assetMath';

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

const TYPE_SNAPSHOT_PREFIX = 'TYPE_';
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

function isAssetType(value: string): value is AssetType {
  return value in ASSET_TYPE_CONFIG;
}

function buildCarriedSeries(
  dates: string[],
  entries: AssetHistoryEntry[],
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

function upsertRealtimeSnapshot(
  entries: AssetHistoryEntry[],
  assetId: string,
  currentBalance: number,
  today: string
): AssetHistoryEntry[] {
  const sortedEntries = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const previousEntry = [...sortedEntries].reverse().find((entry) => entry.date < today);
  const changeAmount = previousEntry ? currentBalance - previousEntry.balance : 0;
  const householdId = sortedEntries[0]?.householdId ?? '';
  const createdAt = previousEntry?.createdAt ?? sortedEntries[0]?.createdAt ?? Timestamp.now();

  const realtimeEntry: AssetHistoryEntry = {
    id: `realtime_${assetId}_${today}`,
    householdId,
    assetId,
    balance: currentBalance,
    date: today,
    changeAmount,
    memo: '실시간 계산',
    createdAt,
  };

  return [...sortedEntries.filter((entry) => entry.date !== today), realtimeEntry]
    .sort((a, b) => a.date.localeCompare(b.date));
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
  const { themeConfig } = useTheme();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [history, setHistory] = useState<AssetHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodType>('3M');
  const [financialOnly, setFinancialOnly] = useState(false);
  const [enabledSeries, setEnabledSeries] = useState<Set<TrendSeriesKey>>(new Set<TrendSeriesKey>(['all']));
  const hasInitializedSeries = useRef(false);
  const trendChartRef = useRef<ChartJS<'line', Array<number | null>, string> | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToAssets((nextAssets) => {
      setAssets(nextAssets);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    processSavingsAutoContributions().catch(console.error);
    processLoanAutoRepayments().catch(console.error);
    refreshAllPhysicalGoldValues().catch(console.error);
  }, []);

  useEffect(() => {
    const fetchHistory = async () => {
      setIsLoading(true);

      try {
        const now = new Date();
        const endDate = formatLocalDate(now);
        let startDate = formatLocalDate(new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()));

        switch (selectedPeriod) {
          case '6M':
            startDate = formatLocalDate(new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()));
            break;
          case '1Y':
            startDate = formatLocalDate(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()));
            break;
          case 'ALL':
            startDate = '2020-01-01';
            break;
          default:
            break;
        }

        const historyData = await getAssetHistoryByPeriod(startDate, endDate);
        setHistory(historyData);
      } catch (error) {
        console.error('자산 통계 이력을 불러오지 못했습니다.', error);
      } finally {
        setIsLoading(false);
      }
    };

    void fetchHistory();
  }, [selectedPeriod]);

  const activeAssets = useMemo(() => assets.filter((asset) => asset.isActive), [assets]);
  const visibleAssets = useMemo(
    () => activeAssets.filter((asset) => !financialOnly || (asset.type !== 'property' && asset.type !== 'loan')),
    [activeAssets, financialOnly]
  );
  const totalAssets = useMemo(() => sumSignedAssetBalances(visibleAssets), [visibleAssets]);
  const typeTotals = useMemo(() => sumSignedBalancesByAssetType(visibleAssets), [visibleAssets]);
  const today = formatLocalDate(new Date());
  const snapshotType = financialOnly ? 'FINANCIAL' : 'TOTAL';

  const totalSnapshots = useMemo(
    () => history
      .filter((entry) => entry.assetId === snapshotType)
      .sort((a, b) => a.date.localeCompare(b.date)),
    [history, snapshotType]
  );

  const typeSnapshots = useMemo(() => {
    const result = {} as Record<AssetType, AssetHistoryEntry[]>;

    ASSET_TYPE_ORDER.forEach((type) => {
      result[type] = [];
    });

    history.forEach((entry) => {
      if (!entry.assetId.startsWith(TYPE_SNAPSHOT_PREFIX)) {
        return;
      }

      const typeKey = entry.assetId.slice(TYPE_SNAPSHOT_PREFIX.length);

      if (!isAssetType(typeKey)) {
        return;
      }

      if (financialOnly && (typeKey === 'property' || typeKey === 'loan')) {
        return;
      }

      result[typeKey].push(entry);
    });

    ASSET_TYPE_ORDER.forEach((type) => {
      result[type].sort((a, b) => a.date.localeCompare(b.date));
    });

    return result;
  }, [financialOnly, history]);

  const displayTypeSnapshots = useMemo(() => {
    const result = {} as Record<AssetType, AssetHistoryEntry[]>;

    ASSET_TYPE_ORDER.forEach((type) => {
      result[type] = upsertRealtimeSnapshot(typeSnapshots[type], `TYPE_${type}`, typeTotals[type], today);
    });

    return result;
  }, [today, typeSnapshots, typeTotals]);

  const displayTotalSnapshots = useMemo(
    () => upsertRealtimeSnapshot(totalSnapshots, snapshotType, totalAssets, today),
    [snapshotType, today, totalAssets, totalSnapshots]
  );

  const availableTypes = useMemo(() => {
    const available = new Set<AssetType>();

    visibleAssets.forEach((asset) => {
      available.add(asset.type);
    });

    return ASSET_TYPE_ORDER.filter((type) => available.has(type));
  }, [visibleAssets]);

  useEffect(() => {
    const allowedKeys = new Set<TrendSeriesKey>(['all', ...availableTypes]);

    setEnabledSeries((prev) => {
      if (!hasInitializedSeries.current && availableTypes.length > 0) {
        hasInitializedSeries.current = true;
        return new Set<TrendSeriesKey>(['all', ...availableTypes]);
      }

      const next = new Set<TrendSeriesKey>(
        Array.from(prev).filter((key) => allowedKeys.has(key))
      );

      if (next.size === 0) {
        return new Set<TrendSeriesKey>(['all', ...availableTypes]);
      }

      return next;
    });
  }, [availableTypes]);

  const summaryTotals = useMemo(() => {
    if (displayTotalSnapshots.length > 0) {
      return displayTotalSnapshots.map((entry) => ({
        date: entry.date,
        total: entry.balance,
        change: entry.changeAmount,
      }));
    }

    return [{
      date: today,
      total: totalAssets,
      change: 0,
    }];
  }, [displayTotalSnapshots, today, totalAssets]);

  const chartDates = useMemo(() => {
    const dateSet = new Set<string>();

    if (enabledSeries.has('all')) {
      displayTotalSnapshots.forEach((entry) => dateSet.add(entry.date));
    }

    availableTypes.forEach((type) => {
      if (!enabledSeries.has(type)) {
        return;
      }

      displayTypeSnapshots[type].forEach((entry) => dateSet.add(entry.date));
    });

    if (dateSet.size === 0) {
      dateSet.add(today);
    }

    return Array.from(dateSet).sort();
  }, [availableTypes, displayTotalSnapshots, displayTypeSnapshots, enabledSeries, today]);

  const chartData = useMemo<ChartData<'line', Array<number | null>, string>>(() => {
    const labels = chartDates.map((dateString) => {
      const date = new Date(dateString);
      return `${date.getMonth() + 1}/${date.getDate()}`;
    });

    const datasets: Array<ChartDataset<'line', Array<number | null>>> = [];

    if (enabledSeries.has('all')) {
      datasets.push({
        label: financialOnly ? '금융자산' : '전체',
        data: buildCarriedSeries(chartDates, displayTotalSnapshots, totalAssets),
        borderColor: '#3B82F6',
        backgroundColor: 'rgba(59, 130, 246, 0.10)',
        borderWidth: 2,
        fill: true,
        tension: 0.3,
        cubicInterpolationMode: 'monotone',
        spanGaps: true,
        pointRadius: chartDates.length > 14 ? 0 : 2.5,
        pointHoverRadius: 4,
      });
    }

    availableTypes.forEach((type) => {
      if (!enabledSeries.has(type)) {
        return;
      }

      const config = ASSET_TYPE_CONFIG[type];

      datasets.push({
        label: config.label,
        data: buildCarriedSeries(chartDates, displayTypeSnapshots[type], typeTotals[type]),
        borderColor: config.color,
        backgroundColor: `${config.color}20`,
        borderWidth: 1.75,
        fill: false,
        tension: 0.3,
        cubicInterpolationMode: 'monotone',
        spanGaps: true,
        pointRadius: chartDates.length > 14 ? 0 : 2,
        pointHoverRadius: 4,
      });
    });

    return { labels, datasets };
  }, [
    availableTypes,
    chartDates,
    displayTotalSnapshots,
    displayTypeSnapshots,
    enabledSeries,
    financialOnly,
    totalAssets,
    typeTotals,
  ]);

  const chartOptions = useMemo<ChartOptions<'line'>>(
    () => ({
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
    []
  );

  const periodChange = summaryTotals.length > 1
    ? summaryTotals[summaryTotals.length - 1].total - summaryTotals[0].total
    : 0;

  const periodChangeRate = summaryTotals.length > 1 && summaryTotals[0].total > 0
    ? (periodChange / summaryTotals[0].total) * 100
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

        {isLoading ? (
          <div className="py-12 text-center text-slate-400">불러오는 중...</div>
        ) : (
          <div className="space-y-4">
            <div className="relative rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <button
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
                {financialOnly ? '금융자산' : '현재 총 자산'}
              </p>
              <p className="text-2xl font-bold text-slate-900">
                {totalAssets.toLocaleString()}
                <span className="ml-1 text-base font-medium text-slate-400">원</span>
              </p>
              <p className="mt-0.5 text-sm text-slate-400">
                ({formatKoreanUnit(totalAssets)}원)
              </p>
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
                  key={period}
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
              <h3 className="mb-4 text-sm font-semibold text-slate-700">자산 추이 그래프</h3>

              <div className="mb-4 flex flex-wrap gap-2">
                <button
                  onClick={() => toggleSeries('all')}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition-all ${
                    enabledSeries.has('all')
                      ? 'bg-blue-500 text-white shadow-md'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                >
                  {financialOnly ? '금융자산' : '전체 자산'}
                </button>

                {availableTypes.map((type) => {
                  const config = ASSET_TYPE_CONFIG[type];
                  const isEnabled = enabledSeries.has(type);

                  return (
                    <button
                      key={type}
                      onClick={() => toggleSeries(type)}
                      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-all ${
                        isEnabled
                          ? 'text-white shadow-md'
                          : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      }`}
                      style={{
                        backgroundColor: isEnabled ? config.color : undefined,
                      }}
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: isEnabled ? 'white' : config.color }}
                      />
                      {config.label}
                    </button>
                  );
                })}
              </div>

              <div className="h-[280px]" onClick={(event) => event.stopPropagation()}>
                {chartData.datasets.length > 0 ? (
                  <Line ref={trendChartRef} data={chartData} options={chartOptions} />
                ) : (
                  <div className="flex h-full items-center justify-center text-slate-400">
                    표시할 자산 데이터가 없습니다.
                  </div>
                )}
              </div>
            </div>

            <AssetProfitChart
              totalSnapshots={displayTotalSnapshots}
              totalAssets={totalAssets}
            />

            <AssetDividendChart />
          </div>
        )}
      </div>
    </main>
  );
}
