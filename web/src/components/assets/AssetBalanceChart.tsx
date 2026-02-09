'use client';

import { useMemo, useState, useEffect } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { Asset, AssetHistoryEntry, ASSET_TYPE_CONFIG } from '@/types/asset';
import { getAssetHistoryByPeriod } from '@/lib/assetService';
import { Portal } from '@/components/common';
import { X, Calendar } from 'lucide-react';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface AssetBalanceChartProps {
  isOpen: boolean;
  onClose: () => void;
  asset: Asset | null;
  assets: Asset[];
}

type PeriodType = '3m' | '6m' | '1y' | 'all';

const PERIODS: { key: PeriodType; label: string }[] = [
  { key: '3m', label: '3개월' },
  { key: '6m', label: '6개월' },
  { key: '1y', label: '1년' },
  { key: 'all', label: '전체' },
];

export default function AssetBalanceChart({
  isOpen,
  onClose,
  asset,
  assets,
}: AssetBalanceChartProps) {
  const [period, setPeriod] = useState<PeriodType>('3m');
  const [history, setHistory] = useState<AssetHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  // 기간에 따른 시작/종료 날짜 계산
  const { startDate, endDate } = useMemo(() => {
    const now = new Date();
    const end = now.toISOString().split('T')[0];
    let start: Date;

    switch (period) {
      case '3m':
        start = new Date(now.getFullYear(), now.getMonth() - 3, 1);
        break;
      case '6m':
        start = new Date(now.getFullYear(), now.getMonth() - 6, 1);
        break;
      case '1y':
        start = new Date(now.getFullYear() - 1, now.getMonth(), 1);
        break;
      case 'all':
      default:
        start = new Date(2020, 0, 1);
        break;
    }

    return {
      startDate: start.toISOString().split('T')[0],
      endDate: end,
    };
  }, [period]);

  // 이력 데이터 로드
  useEffect(() => {
    if (!isOpen) return;

    setIsLoading(true);
    getAssetHistoryByPeriod(startDate, endDate)
      .then(setHistory)
      .catch((error) => {
        console.error('이력 조회 오류:', error);
        setHistory([]);
      })
      .finally(() => setIsLoading(false));
  }, [isOpen, startDate, endDate]);

  // 차트 데이터 생성
  const chartData = useMemo(() => {
    if (history.length === 0) {
      return { labels: [], datasets: [] };
    }

    // 날짜별로 그룹화
    const dateMap: Record<string, Record<string, number>> = {};
    const targetAssets = showAll ? assets : asset ? [asset] : [];
    const assetIds = new Set(targetAssets.map((a) => a.id));

    // 각 자산의 초기 잔액 (첫 이력 이전 값)
    const initialBalances: Record<string, number> = {};
    targetAssets.forEach((a) => {
      initialBalances[a.id] = 0;
    });

    // 이력에서 각 자산별 날짜별 잔액 추출
    history
      .filter((h) => assetIds.has(h.assetId))
      .forEach((h) => {
        if (!dateMap[h.date]) {
          dateMap[h.date] = {};
        }
        dateMap[h.date][h.assetId] = h.balance;
      });

    // 날짜 정렬
    const dates = Object.keys(dateMap).sort();

    if (dates.length === 0) {
      return { labels: [], datasets: [] };
    }

    // 각 자산별 데이터 시리즈 생성
    const datasets: any[] = [];

    if (showAll) {
      // 전체 자산 합계
      const totalData: number[] = [];
      let runningBalances: Record<string, number> = { ...initialBalances };

      dates.forEach((date) => {
        if (dateMap[date]) {
          Object.entries(dateMap[date]).forEach(([assetId, balance]) => {
            runningBalances[assetId] = balance;
          });
        }
        const total = Object.values(runningBalances).reduce((sum, b) => sum + b, 0);
        totalData.push(total);
      });

      datasets.push({
        label: '총 자산',
        data: totalData,
        borderColor: '#3B82F6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        borderWidth: 3,
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointHoverRadius: 6,
      });
    } else if (asset) {
      // 단일 자산
      const assetData: number[] = [];
      let lastBalance = 0;

      dates.forEach((date) => {
        if (dateMap[date]?.[asset.id] !== undefined) {
          lastBalance = dateMap[date][asset.id];
        }
        assetData.push(lastBalance);
      });

      const config = ASSET_TYPE_CONFIG[asset.type];
      datasets.push({
        label: asset.name,
        data: assetData,
        borderColor: asset.color || config.color,
        backgroundColor: `${asset.color || config.color}20`,
        borderWidth: 3,
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointHoverRadius: 6,
      });
    }

    return {
      labels: dates.map((d) => {
        const [year, month, day] = d.split('-');
        return `${month}/${day}`;
      }),
      datasets,
    };
  }, [history, asset, assets, showAll]);

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
    plugins: {
      legend: {
        display: showAll,
        position: 'top' as const,
      },
      tooltip: {
        callbacks: {
          label: function (context: any) {
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
      },
      y: {
        beginAtZero: false,
        ticks: {
          callback: function (value: any) {
            if (value >= 100000000) {
              return `${(value / 100000000).toFixed(1)}억`;
            }
            if (value >= 10000) {
              return `${Math.floor(value / 10000)}만`;
            }
            return value.toLocaleString();
          },
        },
      },
    },
  };

  if (!isOpen) return null;

  return (
    <Portal>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]">
        <div className="bg-white rounded-2xl m-4 max-w-2xl w-full shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
          {/* 헤더 */}
          <div className="p-4 border-b border-slate-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-800">
                {showAll ? '총 자산 추이' : asset?.name || '자산 추이'}
              </h3>
              <button
                onClick={onClose}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            {/* 컨트롤 */}
            <div className="flex items-center justify-between gap-4">
              {/* 기간 선택 */}
              <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
                {PERIODS.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setPeriod(key)}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                      period === key
                        ? 'bg-white text-slate-800 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* 전체/개별 토글 */}
              {asset && assets.length > 1 && (
                <button
                  onClick={() => setShowAll(!showAll)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    showAll
                      ? 'bg-blue-100 text-blue-600'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                >
                  {showAll ? '전체 자산' : '이 자산만'}
                </button>
              )}
            </div>
          </div>

          {/* 차트 */}
          <div className="flex-1 p-4">
            {isLoading ? (
              <div className="h-72 flex items-center justify-center text-slate-400">
                로딩 중...
              </div>
            ) : chartData.datasets.length > 0 ? (
              <div className="h-72">
                <Line data={chartData} options={options} />
              </div>
            ) : (
              <div className="h-72 flex flex-col items-center justify-center text-slate-400">
                <Calendar className="w-12 h-12 mb-3 text-slate-300" />
                <p>이 기간에 이력이 없습니다.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
