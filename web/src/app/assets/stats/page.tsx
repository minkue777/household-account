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
import { Line, Bar } from 'react-chartjs-2';
import { ArrowLeft, ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';
import { Asset, AssetHistoryEntry, StockHolding } from '@/types/asset';
import { subscribeToAssets, getAssetHistoryByPeriod, getAllStockHoldings, saveDividendSnapshot } from '@/lib/assetService';
import { useTheme } from '@/contexts/ThemeContext';

// 배당금 정보 인터페이스
interface DividendInfo {
  code: string;
  name: string;
  recentDividend: number | null;
  paymentDate: string | null;
  frequency: number | null;
  dividendYield: number | null;
}

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
type ProfitViewType = 'monthly' | 'daily';

export default function AssetStatsPage() {
  const { themeConfig } = useTheme();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [history, setHistory] = useState<AssetHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodType>('3M');

  // 금융자산만 보기 필터
  const [financialOnly, setFinancialOnly] = useState(false);

  // 수익 차트 관련 상태
  const [profitView, setProfitView] = useState<ProfitViewType>('monthly');
  const [profitYear, setProfitYear] = useState(new Date().getFullYear());
  const [profitMonth, setProfitMonth] = useState(new Date().getMonth() + 1);
  const [showProfitTable, setShowProfitTable] = useState(false);

  // 배당금 차트 관련 상태
  const [dividendYear, setDividendYear] = useState(new Date().getFullYear());
  const [stockHoldings, setStockHoldings] = useState<StockHolding[]>([]);
  const [dividendInfoMap, setDividendInfoMap] = useState<Record<string, DividendInfo>>({});
  const [isDividendLoading, setIsDividendLoading] = useState(false);

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

  // 보유 종목 및 배당금 정보 조회
  useEffect(() => {
    const fetchDividendData = async () => {
      setIsDividendLoading(true);
      try {
        // 모든 주식 보유 종목 가져오기
        const holdings = await getAllStockHoldings();
        setStockHoldings(holdings);

        // 각 종목의 배당금 정보 조회
        const dividendMap: Record<string, DividendInfo> = {};

        for (const holding of holdings) {
          if (!holding.stockCode) continue;

          // 이미 조회한 종목은 스킵
          if (dividendMap[holding.stockCode]) continue;

          try {
            const response = await fetch(`/api/stock/dividend?code=${holding.stockCode}`);
            if (response.ok) {
              const data = await response.json();
              dividendMap[holding.stockCode] = data;
            }
          } catch (error) {
            console.error(`배당금 조회 오류 (${holding.stockCode}):`, error);
          }
        }

        setDividendInfoMap(dividendMap);
      } catch (error) {
        console.error('보유 종목 조회 오류:', error);
      } finally {
        setIsDividendLoading(false);
      }
    };

    fetchDividendData();
  }, []);

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

  // 스냅샷 필터링 (필터에 따라 TOTAL 또는 FINANCIAL)
  const totalSnapshots = useMemo(() => {
    return history
      .filter((h) => h.assetId === snapshotType)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [history, snapshotType]);

  // 전날 데이터가 있는 날짜 Set (초기 등록 데이터 필터링용)
  const datesWithPreviousDay = useMemo(() => {
    const allDates = new Set(totalSnapshots.map((h) => h.date));
    const validDates = new Set<string>();

    allDates.forEach((date) => {
      const prevDate = new Date(date);
      prevDate.setDate(prevDate.getDate() - 1);
      const prevDateStr = prevDate.toISOString().split('T')[0];
      if (allDates.has(prevDateStr)) {
        validDates.add(date);
      }
    });

    return validDates;
  }, [totalSnapshots]);

  // 월별 수익 데이터 계산
  const monthlyProfitData = useMemo(() => {
    const monthlyData: { month: number; profit: number; rate: number }[] = [];

    for (let month = 1; month <= 12; month++) {
      const startDate = `${profitYear}-${String(month).padStart(2, '0')}-01`;
      const endDate = `${profitYear}-${String(month).padStart(2, '0')}-31`;

      // 해당 월의 총자산 스냅샷 중 전날 데이터가 있는 것만
      const monthSnapshots = totalSnapshots.filter(
        (h) => h.date >= startDate && h.date <= endDate && datesWithPreviousDay.has(h.date)
      );

      const totalChange = monthSnapshots.reduce((sum, h) => sum + h.changeAmount, 0);

      // 월초 자산 추정
      const firstEntry = monthSnapshots[0];
      const baseAmount = firstEntry ? firstEntry.balance - firstEntry.changeAmount : totalAssets;
      const rate = baseAmount > 0 ? (totalChange / baseAmount) * 100 : 0;

      monthlyData.push({
        month,
        profit: totalChange,
        rate,
      });
    }

    return monthlyData;
  }, [totalSnapshots, profitYear, totalAssets, datesWithPreviousDay]);

  // 일별 수익 데이터 계산
  const dailyProfitData = useMemo(() => {
    const daysInMonth = new Date(profitYear, profitMonth, 0).getDate();
    const dailyData: { day: number; profit: number; rate: number }[] = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${profitYear}-${String(profitMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      // 해당 날짜의 총자산 스냅샷 (전날 데이터가 있는 경우만)
      const daySnapshot = totalSnapshots.find(
        (h) => h.date === dateStr && datesWithPreviousDay.has(h.date)
      );

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
  }, [totalSnapshots, profitYear, profitMonth, datesWithPreviousDay]);

  // 수익 바 차트 데이터
  const profitChartData = useMemo(() => {
    if (profitView === 'monthly') {
      return {
        labels: monthlyProfitData.map((d) => String(d.month)),
        datasets: [
          {
            data: monthlyProfitData.map((d) => d.profit),
            backgroundColor: monthlyProfitData.map((d) =>
              d.profit >= 0 ? 'rgba(239, 68, 68, 0.8)' : 'rgba(59, 130, 246, 0.8)'
            ),
            borderRadius: 4,
          },
        ],
      };
    } else {
      return {
        labels: dailyProfitData.map((d) => String(d.day)),
        datasets: [
          {
            data: dailyProfitData.map((d) => d.profit),
            backgroundColor: dailyProfitData.map((d) =>
              d.profit >= 0 ? 'rgba(239, 68, 68, 0.8)' : 'rgba(59, 130, 246, 0.8)'
            ),
            borderRadius: 2,
          },
        ],
      };
    }
  }, [profitView, monthlyProfitData, dailyProfitData]);

  const profitChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: function (context: any) {
            const value = context.raw as number;
            return `${value >= 0 ? '+' : ''}${value.toLocaleString()}원`;
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
          color: 'rgba(0, 0, 0, 0.05)',
        },
        title: {
          display: true,
          text: '(백만원)',
          font: { size: 11 },
          color: '#94a3b8',
        },
        ticks: {
          callback: function (value: any) {
            // 백만원 단위로 표시
            if (Math.abs(value) >= 1000000) {
              return (value / 1000000).toFixed(1);
            } else if (Math.abs(value) >= 10000) {
              return (value / 1000000).toFixed(2);
            }
            return value;
          },
        },
      },
    },
  };

  // 수익 테이블 데이터 (내림차순)
  const profitTableData = useMemo(() => {
    if (profitView === 'monthly') {
      return monthlyProfitData
        .filter((d) => d.profit !== 0)
        .sort((a, b) => b.month - a.month);
    } else {
      return dailyProfitData
        .filter((d) => d.profit !== 0)
        .sort((a, b) => b.day - a.day);
    }
  }, [profitView, monthlyProfitData, dailyProfitData]);

  // 기간 변동액
  const periodChange = dailyTotals.length > 1
    ? dailyTotals[dailyTotals.length - 1].total - dailyTotals[0].total
    : 0;

  const periodChangeRate = dailyTotals.length > 1 && dailyTotals[0].total > 0
    ? ((periodChange / dailyTotals[0].total) * 100)
    : 0;

  // 월별 배당금 데이터 계산 (실제 공시된 배당금만 해당 월에 표시)
  const monthlyDividendData = useMemo(() => {
    const monthlyData = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      dividend: 0,
    }));

    // 각 보유 종목별로 배당금 계산
    stockHoldings.forEach((holding) => {
      const dividendInfo = dividendInfoMap[holding.stockCode];
      if (!dividendInfo || !dividendInfo.recentDividend || !dividendInfo.paymentDate) {
        return;
      }

      // 지급일에서 연도/월 추출 (YYYY/MM/DD 형식)
      const [paymentYear, paymentMonth] = dividendInfo.paymentDate.split('/').map(Number);

      // 선택된 연도와 일치하는 경우에만 표시
      if (paymentYear === dividendYear) {
        const quantity = holding.quantity || 0;
        const dividendAmount = dividendInfo.recentDividend * quantity;
        monthlyData[paymentMonth - 1].dividend += dividendAmount;
      }
    });

    return monthlyData;
  }, [stockHoldings, dividendInfoMap, dividendYear]);

  // 배당금 스냅샷 저장 (변경 시에만)
  useEffect(() => {
    if (isDividendLoading || stockHoldings.length === 0) return;

    const monthlyAmounts = monthlyDividendData.map((d) => d.dividend);
    // 모두 0이면 저장하지 않음
    if (monthlyAmounts.every((v) => v === 0)) return;

    saveDividendSnapshot(dividendYear, monthlyAmounts);
  }, [monthlyDividendData, dividendYear, isDividendLoading, stockHoldings.length]);

  // 배당금 바 차트 데이터
  const dividendChartData = useMemo(() => {
    return {
      labels: monthlyDividendData.map((d) => String(d.month)),
      datasets: [
        {
          data: monthlyDividendData.map((d) => d.dividend),
          backgroundColor: 'rgba(16, 185, 129, 0.8)', // 초록색
          borderRadius: 4,
        },
      ],
    };
  }, [monthlyDividendData]);

  const dividendChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: function (context: any) {
            const value = context.raw as number;
            return `${value.toLocaleString()}원`;
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
          color: 'rgba(0, 0, 0, 0.05)',
        },
        title: {
          display: true,
          text: '(만원)',
          font: { size: 11 },
          color: '#94a3b8',
        },
        ticks: {
          callback: function (value: any) {
            if (Math.abs(value) >= 10000) {
              return (value / 10000).toFixed(0);
            }
            return value;
          },
        },
      },
    },
  };

  // 배당금 합계
  const totalDividend = monthlyDividendData.reduce((sum, d) => sum + d.dividend, 0);

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
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
              {/* 헤더: 제목 + 월별/일별 토글 */}
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-700">수익 차트</h3>
                <div className="flex bg-slate-100 rounded-lg p-0.5">
                  <button
                    onClick={() => setProfitView('monthly')}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                      profitView === 'monthly'
                        ? 'bg-white text-slate-800 shadow-sm'
                        : 'text-slate-500'
                    }`}
                  >
                    월별
                  </button>
                  <button
                    onClick={() => setProfitView('daily')}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                      profitView === 'daily'
                        ? 'bg-white text-slate-800 shadow-sm'
                        : 'text-slate-500'
                    }`}
                  >
                    일별
                  </button>
                </div>
              </div>

              {/* 연도/월 네비게이션 */}
              <div className="flex items-center justify-center gap-4 mb-4">
                <button
                  onClick={() => {
                    if (profitView === 'monthly') {
                      setProfitYear((y) => y - 1);
                    } else {
                      if (profitMonth === 1) {
                        setProfitYear((y) => y - 1);
                        setProfitMonth(12);
                      } else {
                        setProfitMonth((m) => m - 1);
                      }
                    }
                  }}
                  className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <ChevronLeft className="w-5 h-5 text-slate-500" />
                </button>
                <span className="text-sm font-medium text-slate-700 min-w-[100px] text-center">
                  {profitView === 'monthly'
                    ? `${profitYear}년`
                    : `${profitYear}년 ${profitMonth}월`}
                </span>
                <button
                  onClick={() => {
                    if (profitView === 'monthly') {
                      setProfitYear((y) => y + 1);
                    } else {
                      if (profitMonth === 12) {
                        setProfitYear((y) => y + 1);
                        setProfitMonth(1);
                      } else {
                        setProfitMonth((m) => m + 1);
                      }
                    }
                  }}
                  className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <ChevronRight className="w-5 h-5 text-slate-500" />
                </button>
              </div>

              {/* 바 차트 */}
              <div className="h-[180px] mb-4">
                <Bar data={profitChartData} options={profitChartOptions} />
              </div>

              {/* 수익 테이블 (접기/펼치기) */}
              <div>
                <button
                  onClick={() => setShowProfitTable(!showProfitTable)}
                  className="w-full flex items-center justify-between text-sm font-medium text-slate-600 py-2 hover:text-slate-800 transition-colors"
                >
                  <span>{profitView === 'monthly' ? '월별' : '일별'} 평가수익</span>
                  {showProfitTable ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>
                {showProfitTable && (
                  <>
                    {profitTableData.length === 0 ? (
                      <p className="text-center py-4 text-slate-400 text-sm">
                        변동 내역이 없습니다
                      </p>
                    ) : (
                      <div className="space-y-1 max-h-[200px] overflow-y-auto">
                        {/* 테이블 헤더 */}
                        <div className="flex items-center text-xs text-slate-500 py-2 border-b border-slate-100">
                          <span className="flex-1">{profitView === 'monthly' ? '월' : '일'}</span>
                          <span className="w-20 text-right">수익률</span>
                          <span className="w-28 text-right">수익</span>
                        </div>
                        {/* 테이블 바디 */}
                        {profitTableData.map((item) => (
                          <div
                            key={profitView === 'monthly' ? (item as any).month : (item as any).day}
                            className="flex items-center py-2 text-sm"
                          >
                            <span className="flex-1 text-slate-700">
                              {profitView === 'monthly'
                                ? `${(item as any).month}월`
                                : `${(item as any).day}일`}
                            </span>
                            <span
                              className={`w-20 text-right font-medium ${
                                item.profit >= 0 ? 'text-red-500' : 'text-blue-500'
                              }`}
                            >
                              {item.profit >= 0 ? '+' : ''}
                              {item.rate.toFixed(2)}%
                            </span>
                            <span
                              className={`w-28 text-right font-medium ${
                                item.profit >= 0 ? 'text-red-500' : 'text-blue-500'
                              }`}
                            >
                              {item.profit >= 0 ? '+' : ''}
                              {item.profit.toLocaleString()}원
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* 배당금 차트 */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-700">배당금 현황</h3>
              </div>

              {/* 연도 네비게이션 */}
              <div className="flex items-center justify-center gap-4 mb-4">
                <button
                  onClick={() => setDividendYear((y) => y - 1)}
                  className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <ChevronLeft className="w-5 h-5 text-slate-500" />
                </button>
                <span className="text-sm font-medium text-slate-700 min-w-[80px] text-center">
                  {dividendYear}년
                </span>
                <button
                  onClick={() => setDividendYear((y) => y + 1)}
                  className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <ChevronRight className="w-5 h-5 text-slate-500" />
                </button>
              </div>

              {/* 배당금 바 차트 */}
              <div className="h-[180px] mb-4">
                <Bar data={dividendChartData} options={dividendChartOptions} />
              </div>

              {/* 연간 배당금 합계 */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                <span className="text-sm text-slate-600">연간 배당금</span>
                <span className="text-lg font-bold text-emerald-600">
                  {totalDividend.toLocaleString()}원
                </span>
              </div>

              {isDividendLoading ? (
                <p className="text-xs text-slate-400 mt-2 text-center">
                  배당금 정보 조회 중...
                </p>
              ) : totalDividend === 0 ? (
                <p className="text-xs text-slate-400 mt-2 text-center">
                  {stockHoldings.length === 0
                    ? '보유 종목이 없습니다'
                    : '배당금 정보가 없는 종목입니다'}
                </p>
              ) : null}
            </div>

          </div>
        )}
      </div>
    </main>
  );
}
