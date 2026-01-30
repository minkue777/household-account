'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
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
import { ArrowLeft, TrendingUp, TrendingDown } from 'lucide-react';
import { Asset, AssetHistoryEntry } from '@/types/asset';
import { subscribeToAssets, getAssetHistoryByPeriod } from '@/lib/assetService';
import { useTheme } from '@/contexts/ThemeContext';

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

type PeriodType = '1M' | '3M' | '6M' | '1Y' | 'ALL';

export default function AssetStatsPage() {
  const { themeConfig } = useTheme();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [history, setHistory] = useState<AssetHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodType>('1M');

  // 현재 날짜 정보
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

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
          case '1M':
            startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()).toISOString().split('T')[0];
            break;
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
            startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()).toISOString().split('T')[0];
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

  // 현재 총 자산
  const totalAssets = assets
    .filter((a) => a.isActive)
    .reduce((sum, a) => sum + a.currentBalance, 0);

  // 일별 자산 합계 계산
  const dailyTotals = useMemo(() => {
    // 날짜별 변동 그룹화
    const changesByDate: Record<string, number> = {};

    history.forEach((entry) => {
      if (!changesByDate[entry.date]) {
        changesByDate[entry.date] = 0;
      }
      changesByDate[entry.date] += entry.changeAmount;
    });

    // 날짜순 정렬
    const sortedDates = Object.keys(changesByDate).sort();

    // 누적 합계 계산 (현재 총액에서 역산)
    let runningTotal = totalAssets;
    const dailyData: { date: string; total: number; change: number }[] = [];

    // 역순으로 누적 계산
    for (let i = sortedDates.length - 1; i >= 0; i--) {
      const date = sortedDates[i];
      const change = changesByDate[date];
      dailyData.unshift({
        date,
        total: runningTotal,
        change,
      });
      runningTotal -= change;
    }

    // 시작점 추가 (이력이 없는 경우 현재값만)
    if (dailyData.length === 0) {
      dailyData.push({
        date: new Date().toISOString().split('T')[0],
        total: totalAssets,
        change: 0,
      });
    }

    return dailyData;
  }, [history, totalAssets]);

  // 이번 달 일별 변동 내역
  const monthlyChanges = useMemo(() => {
    const startOfMonth = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
    const endOfMonth = `${currentYear}-${String(currentMonth).padStart(2, '0')}-31`;

    // 날짜별 변동 그룹화
    const changesByDate: Record<string, { total: number; details: AssetHistoryEntry[] }> = {};

    history
      .filter((h) => h.date >= startOfMonth && h.date <= endOfMonth)
      .forEach((entry) => {
        if (!changesByDate[entry.date]) {
          changesByDate[entry.date] = { total: 0, details: [] };
        }
        changesByDate[entry.date].total += entry.changeAmount;
        changesByDate[entry.date].details.push(entry);
      });

    // 날짜순 정렬 (내림차순)
    return Object.entries(changesByDate)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, data]) => ({
        date,
        ...data,
      }));
  }, [history, currentYear, currentMonth]);

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
        ticks: {
          callback: function (value: any) {
            if (value >= 100000000) {
              return `${(value / 100000000).toFixed(1)}억`;
            } else if (value >= 10000) {
              return `${(value / 10000).toFixed(0)}만`;
            }
            return value;
          },
        },
      },
    },
  };

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
            {/* 현재 총 자산 */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
              <p className="text-sm text-slate-500 mb-1">현재 총 자산</p>
              <p className="text-3xl font-bold text-slate-900">
                {totalAssets.toLocaleString()}
                <span className="text-lg font-medium text-slate-400 ml-1">원</span>
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
              {(['1M', '3M', '6M', '1Y', 'ALL'] as PeriodType[]).map((period) => (
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

            {/* 이번 달 일별 변동 */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">
                {currentMonth}월 일별 변동
              </h3>
              {monthlyChanges.length === 0 ? (
                <p className="text-center py-8 text-slate-400">
                  이번 달 변동 내역이 없습니다
                </p>
              ) : (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {monthlyChanges.map((item) => (
                    <div
                      key={item.date}
                      className="flex items-center justify-between p-3 bg-slate-50 rounded-xl"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center ${
                            item.total > 0
                              ? 'bg-red-100 text-red-500'
                              : item.total < 0
                              ? 'bg-blue-100 text-blue-500'
                              : 'bg-slate-100 text-slate-400'
                          }`}
                        >
                          {item.total > 0 ? (
                            <TrendingUp className="w-4 h-4" />
                          ) : item.total < 0 ? (
                            <TrendingDown className="w-4 h-4" />
                          ) : (
                            <span className="text-xs">-</span>
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-slate-800">
                            {new Date(item.date).getDate()}일
                          </p>
                          <p className="text-xs text-slate-500">
                            {item.details.length}건 변동
                          </p>
                        </div>
                      </div>
                      <p
                        className={`font-semibold ${
                          item.total > 0
                            ? 'text-red-500'
                            : item.total < 0
                            ? 'text-blue-500'
                            : 'text-slate-400'
                        }`}
                      >
                        {item.total > 0 ? '+' : ''}
                        {item.total.toLocaleString()}원
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
