'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  Chart as ChartJS,
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
import { Asset, AssetHistoryEntry } from '@/types/asset';
import { subscribeToAssets, getAssetHistoryByPeriod } from '@/lib/assetService';
import { useTheme } from '@/contexts/ThemeContext';
import AssetProfitChart from '@/components/assets/AssetProfitChart';
import AssetDividendChart from '@/components/assets/AssetDividendChart';

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

// 숫자를 한글 단위로 변환 (예: 1481758652 → "14억 8175만 8652")
function formatKoreanUnit(num: number): string {
  if (num === 0) return '0';

  const absNum = Math.abs(num);
  const sign = num < 0 ? '-' : '';

  const eok = Math.floor(absNum / 100000000);
  const man = Math.floor((absNum % 100000000) / 10000);
  const rest = absNum % 10000;

  const parts = [];
  if (eok > 0) parts.push(`${eok}억`);
  if (man > 0) parts.push(`${man}만`);
  if (rest > 0) parts.push(`${rest}`);

  return sign + parts.join(' ');
}

export default function AssetStatsPage() {
  const { themeConfig } = useTheme();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [history, setHistory] = useState<AssetHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodType>('3M');

  // 금융자산만 보기 필터
  const [financialOnly, setFinancialOnly] = useState(false);

  // 현재 날짜 정보
  const now = new Date();

  // 자산 구독
  useEffect(() => {
    const unsubscribe = subscribeToAssets((newAssets) => {
      setAssets(newAssets);
    });
    return () => unsubscribe();
  }, []);

  // 이력 조회
  useEffect(() => {
    const fetchHistory = async () => {
      setIsLoading(true);
      try {
        // 기간 계산
        const endDate = new Date().toISOString().split('T')[0];
        let startDate: string;

        switch (selectedPeriod) {
          case '3M':
            startDate = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()).toISOString().split('T')[0];
            break;
          case '6M':
            startDate = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()).toISOString().split('T')[0];
            break;
          case '1Y':
            startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).toISOString().split('T')[0];
            break;
          case 'ALL':
            startDate = '2020-01-01';
            break;
          default:
            startDate = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()).toISOString().split('T')[0];
        }

        const historyData = await getAssetHistoryByPeriod(startDate, endDate);
        setHistory(historyData);
      } catch (error) {
        console.error('이력 조회 오류:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchHistory();
  }, [selectedPeriod]);

  // 현재 총 자산 (금융자산 필터 적용 - 부동산 제외)
  const totalAssets = useMemo(() => {
    return assets
      .filter((a) => a.isActive)
      .filter((a) => !financialOnly || a.type !== 'property')
      .reduce((sum, a) => sum + a.currentBalance, 0);
  }, [assets, financialOnly]);

  // 스냅샷 타입 (필터에 따라 TOTAL 또는 FINANCIAL)
  const snapshotType = financialOnly ? 'FINANCIAL' : 'TOTAL';

  // 일별 자산 합계 계산 (스냅샷 사용)
  const dailyTotals = useMemo(() => {
    // 필터에 맞는 스냅샷 필터링
    const snapshots = history
      .filter((entry) => entry.assetId === snapshotType)
      .sort((a, b) => a.date.localeCompare(b.date));

    // 스냅샷이 있으면 직접 사용
    if (snapshots.length > 0) {
      return snapshots.map((entry) => ({
        date: entry.date,
        total: entry.balance,
        change: entry.changeAmount,
      }));
    }

    // 스냅샷이 없으면 현재값만 표시
    return [{
      date: new Date().toISOString().split('T')[0],
      total: totalAssets,
      change: 0,
    }];
  }, [history, snapshotType, totalAssets]);


  // 차트 데이터
  const chartData = useMemo(() => {
    const labels = dailyTotals.map((d) => {
      const date = new Date(d.date);
      return `${date.getMonth() + 1}/${date.getDate()}`;
    });

    return {
      labels,
      datasets: [
        {
          label: '총 자산',
          data: dailyTotals.map((d) => d.total),
          borderColor: '#3B82F6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: dailyTotals.length > 30 ? 0 : 3,
          pointHoverRadius: 5,
        },
      ],
    };
  }, [dailyTotals]);

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: function (context: any) {
            return `${context.raw.toLocaleString()}원`;
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
          callback: function (value: any) {
            return (value / 100000000).toFixed(1);
          },
        },
      },
    },
  };

  // 스냅샷 필터링 (필터에 따라 TOTAL 또는 FINANCIAL)
  const totalSnapshots = useMemo(() => {
    return history
      .filter((h) => h.assetId === snapshotType)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [history, snapshotType]);

  // 기간 변동액
  const periodChange = dailyTotals.length > 1
    ? dailyTotals[dailyTotals.length - 1].total - dailyTotals[0].total
    : 0;

  const periodChangeRate = dailyTotals.length > 1 && dailyTotals[0].total > 0
    ? ((periodChange / dailyTotals[0].total) * 100)
    : 0;

  return (
    <main className="min-h-screen p-4 md:p-6 lg:p-8">
      <div className="max-w-lg mx-auto">
        {/* 헤더 */}
        <header className="mb-6 flex items-center gap-3">
          <Link
            href="/assets"
            className="p-2 hover:bg-white/80 rounded-xl transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </Link>
          <h1
            className="text-lg md:text-xl font-bold"
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
          <div className="text-center py-12 text-slate-400">로딩 중...</div>
        ) : (
          <div className="space-y-4">
            {/* 금융자산 필터 */}
            <div className="flex justify-end">
              <button
                onClick={() => setFinancialOnly(!financialOnly)}
                className={`px-3 py-1.5 text-xs font-medium rounded-full transition-all ${
                  financialOnly
                    ? 'bg-blue-500 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {financialOnly ? '금융자산' : '전체자산'}
              </button>
            </div>

            {/* 현재 총 자산 */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
              <p className="text-sm text-slate-500 mb-1">
                {financialOnly ? '금융자산' : '현재 총 자산'}
              </p>
              <p className="text-2xl font-bold text-slate-900">
                {totalAssets.toLocaleString()}
                <span className="text-base font-medium text-slate-400 ml-1">원</span>
              </p>
              <p className="text-sm text-slate-400 mt-0.5">
                ({formatKoreanUnit(totalAssets)}원)
              </p>
              {periodChange !== 0 && (
                <p className={`text-sm mt-1 ${periodChange > 0 ? 'text-red-500' : 'text-blue-500'}`}>
                  {periodChange > 0 ? '+' : ''}{periodChange.toLocaleString()}원
                  ({periodChangeRate > 0 ? '+' : ''}{periodChangeRate.toFixed(2)}%)
                </p>
              )}
            </div>

            {/* 기간 선택 */}
            <div className="flex gap-2">
              {(['3M', '6M', '1Y', 'ALL'] as PeriodType[]).map((period) => (
                <button
                  key={period}
                  onClick={() => setSelectedPeriod(period)}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all ${
                    selectedPeriod === period
                      ? 'bg-blue-500 text-white'
                      : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
                  }`}
                >
                  {period === 'ALL' ? '전체' : period}
                </button>
              ))}
            </div>

            {/* 자산 추이 차트 */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">자산 추이</h3>
              <div className="h-[250px]">
                <Line data={chartData} options={chartOptions} />
              </div>
            </div>

            {/* 수익 차트 */}
            <AssetProfitChart
              totalSnapshots={totalSnapshots}
              totalAssets={totalAssets}
            />

            {/* 배당금 차트 */}
            <AssetDividendChart />

          </div>
        )}
      </div>
    </main>
  );
}
