'use client';

import { useState, useEffect, useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { StockHolding } from '@/types/asset';
import { getAllStockHoldings, saveDividendSnapshot, getDividendSnapshot } from '@/lib/assetService';

// 배당금 정보 인터페이스
interface DividendInfo {
  code: string;
  name: string;
  recentDividend: number | null;
  paymentDate: string | null;
  frequency: number | null;
  dividendYield: number | null;
}

export default function AssetDividendChart() {
  const [dividendYear, setDividendYear] = useState(new Date().getFullYear());
  const [stockHoldings, setStockHoldings] = useState<StockHolding[]>([]);
  const [dividendInfoMap, setDividendInfoMap] = useState<Record<string, DividendInfo>>({});
  const [isDividendLoading, setIsDividendLoading] = useState(false);
  const [cachedDividendData, setCachedDividendData] = useState<number[] | null>(null);

  // 저장된 배당금 데이터 조회
  useEffect(() => {
    const fetchCachedDividend = async () => {
      const cached = await getDividendSnapshot(dividendYear);
      setCachedDividendData(cached);
    };
    fetchCachedDividend();
  }, [dividendYear]);

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

  // 월별 배당금 데이터 (API 데이터 우선 계산, 없으면 캐시 사용)
  const monthlyDividendData = useMemo(() => {
    // API에서 계산한 데이터 (0부터 시작)
    const calculatedData = Array.from({ length: 12 }, () => 0);

    // 같은 종목이 여러 계좌에 있을 수 있으므로 종목별로 수량 합산
    const quantityByStock: Record<string, number> = {};
    stockHoldings.forEach((holding) => {
      if (holding.stockCode) {
        quantityByStock[holding.stockCode] = (quantityByStock[holding.stockCode] || 0) + (holding.quantity || 0);
      }
    });

    // 종목별 합산된 수량으로 배당금 계산
    Object.entries(quantityByStock).forEach(([stockCode, totalQuantity]) => {
      const dividendInfo = dividendInfoMap[stockCode];
      if (!dividendInfo || !dividendInfo.recentDividend || !dividendInfo.paymentDate) {
        return;
      }

      // 지급일에서 연도/월 추출 (YYYY/MM/DD 형식)
      const [paymentYear, paymentMonth] = dividendInfo.paymentDate.split('/').map(Number);

      // 선택된 연도와 일치하는 경우에만 계산
      if (paymentYear === dividendYear) {
        const dividendAmount = dividendInfo.recentDividend * totalQuantity;
        calculatedData[paymentMonth - 1] += dividendAmount;
      }
    });

    // 월별 데이터 생성 (API 계산값이 있으면 사용, 없으면 캐시값 사용)
    const hasCalculatedData = calculatedData.some((v) => v > 0);

    return Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      dividend: hasCalculatedData ? calculatedData[i] : (cachedDividendData ? cachedDividendData[i] : 0),
    }));
  }, [stockHoldings, dividendInfoMap, dividendYear, cachedDividendData]);

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
        <span className="text-lg font-bold text-red-500">
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
  );
}
