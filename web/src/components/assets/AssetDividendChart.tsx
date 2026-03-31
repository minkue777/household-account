'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { StockHolding } from '@/types/asset';
import { getAllStockHoldings, getDividendSnapshot, saveDividendSnapshot } from '@/lib/assetService';

interface DividendInfo {
  code: string;
  name: string;
  recentDividend: number | null;
  paymentDate: string | null;
  frequency: number | null;
  dividendYield: number | null;
  annualDividendPerShare: number | null;
  isEstimated: boolean;
}

const CURRENT_YEAR = new Date().getFullYear();

function supportsDividendInfo(holding: StockHolding) {
  return (holding.holdingType || 'stock') === 'stock' && /^\d+$/.test(holding.stockCode || '');
}

function getAnnualDividendAmount(dividendInfo: DividendInfo | undefined, quantity: number) {
  if (!dividendInfo || quantity <= 0) {
    return 0;
  }

  if (dividendInfo.annualDividendPerShare && dividendInfo.annualDividendPerShare > 0) {
    return dividendInfo.annualDividendPerShare * quantity;
  }

  if (
    dividendInfo.recentDividend &&
    dividendInfo.recentDividend > 0 &&
    dividendInfo.frequency &&
    dividendInfo.frequency > 0
  ) {
    return dividendInfo.recentDividend * dividendInfo.frequency * quantity;
  }

  return 0;
}

function getProjectedPaymentMonths(dividendInfo: DividendInfo | undefined) {
  if (
    !dividendInfo?.paymentDate ||
    !dividendInfo.frequency ||
    dividendInfo.frequency <= 0 ||
    dividendInfo.frequency > 12
  ) {
    return [];
  }

  const [, paymentMonth] = dividendInfo.paymentDate.split('/').map(Number);
  if (!paymentMonth || paymentMonth < 1 || paymentMonth > 12) {
    return [];
  }

  const interval = Math.max(1, Math.round(12 / dividendInfo.frequency));
  const months = new Set<number>();

  for (let month = paymentMonth; month <= 12; month += interval) {
    months.add(month);
  }

  for (let month = paymentMonth - interval; month >= 1; month -= interval) {
    months.add(month);
  }

  return Array.from(months).sort((a, b) => a - b);
}

function distributeAnnualDividend(
  monthlyTotals: number[],
  annualDividendAmount: number,
  dividendInfo: DividendInfo | undefined
) {
  if (annualDividendAmount <= 0) {
    return;
  }

  const projectedMonths = getProjectedPaymentMonths(dividendInfo);

  if (projectedMonths.length > 0) {
    const perPaymentAmount = annualDividendAmount / projectedMonths.length;
    projectedMonths.forEach((month) => {
      monthlyTotals[month - 1] += perPaymentAmount;
    });
    return;
  }

  const monthlyAverage = annualDividendAmount / 12;
  monthlyTotals.forEach((_, index) => {
    monthlyTotals[index] += monthlyAverage;
  });
}

export default function AssetDividendChart() {
  const [dividendYear, setDividendYear] = useState(CURRENT_YEAR);
  const [stockHoldings, setStockHoldings] = useState<StockHolding[]>([]);
  const [dividendInfoMap, setDividendInfoMap] = useState<Record<string, DividendInfo>>({});
  const [isDividendLoading, setIsDividendLoading] = useState(false);
  const [cachedDividendData, setCachedDividendData] = useState<number[] | null>(null);

  useEffect(() => {
    const fetchCachedDividend = async () => {
      const cached = await getDividendSnapshot(dividendYear);
      setCachedDividendData(cached);
    };

    void fetchCachedDividend();
  }, [dividendYear]);

  useEffect(() => {
    let isCancelled = false;

    const fetchDividendData = async () => {
      setIsDividendLoading(true);

      try {
        const holdings = (await getAllStockHoldings()).filter(supportsDividendInfo);
        if (isCancelled) {
          return;
        }

        setStockHoldings(holdings);

        const uniqueCodes = Array.from(new Set(holdings.map((holding) => holding.stockCode)));
        const responses = await Promise.all(
          uniqueCodes.map(async (stockCode) => {
            try {
              const response = await fetch(`/api/stock/dividend?code=${stockCode}`);
              if (!response.ok) {
                return null;
              }

              const data = (await response.json()) as DividendInfo;
              return [stockCode, data] as const;
            } catch (error) {
              console.error(`배당금 조회 오류 (${stockCode}):`, error);
              return null;
            }
          })
        );

        if (isCancelled) {
          return;
        }

        setDividendInfoMap(
          Object.fromEntries(
            responses.filter((entry): entry is readonly [string, DividendInfo] => entry !== null)
          )
        );
      } catch (error) {
        console.error('보유 종목 조회 오류:', error);
      } finally {
        if (!isCancelled) {
          setIsDividendLoading(false);
        }
      }
    };

    const handleRefresh = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        return;
      }

      void fetchDividendData();
    };

    void fetchDividendData();
    window.addEventListener('focus', handleRefresh);
    document.addEventListener('visibilitychange', handleRefresh);

    return () => {
      isCancelled = true;
      window.removeEventListener('focus', handleRefresh);
      document.removeEventListener('visibilitychange', handleRefresh);
    };
  }, []);

  const monthlyDividendData = useMemo(() => {
    const monthlyTotals = Array.from({ length: 12 }, () => 0);
    const isCurrentYear = dividendYear === CURRENT_YEAR;

    if (isCurrentYear) {
      const quantityByStock: Record<string, number> = {};
      stockHoldings.forEach((holding) => {
        quantityByStock[holding.stockCode] =
          (quantityByStock[holding.stockCode] || 0) + (holding.quantity || 0);
      });

      Object.entries(quantityByStock).forEach(([stockCode, totalQuantity]) => {
        const dividendInfo = dividendInfoMap[stockCode];
        const annualDividendAmount = getAnnualDividendAmount(dividendInfo, totalQuantity);
        distributeAnnualDividend(monthlyTotals, annualDividendAmount, dividendInfo);
      });
    } else if (cachedDividendData) {
      cachedDividendData.forEach((amount, index) => {
        monthlyTotals[index] = amount;
      });
    }

    return monthlyTotals.map((dividend, index) => ({
      month: index + 1,
      dividend,
    }));
  }, [cachedDividendData, dividendInfoMap, dividendYear, stockHoldings]);

  useEffect(() => {
    if (dividendYear !== CURRENT_YEAR || isDividendLoading || stockHoldings.length === 0) {
      return;
    }

    const monthlyAmounts = monthlyDividendData.map((item) => item.dividend);
    if (monthlyAmounts.every((value) => value === 0)) {
      return;
    }

    void saveDividendSnapshot(dividendYear, monthlyAmounts);
  }, [dividendYear, isDividendLoading, monthlyDividendData, stockHoldings.length]);

  const dividendChartData = useMemo(
    () => ({
      labels: monthlyDividendData.map((item) => String(item.month)),
      datasets: [
        {
          data: monthlyDividendData.map((item) => item.dividend),
          backgroundColor: 'rgba(16, 185, 129, 0.8)',
          borderRadius: 4,
        },
      ],
    }),
    [monthlyDividendData]
  );

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
            return `${Math.round(value).toLocaleString()}원`;
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

  const totalDividend = monthlyDividendData.reduce((sum, item) => sum + item.dividend, 0);
  const isCurrentYear = dividendYear === CURRENT_YEAR;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-700">배당금 현황</h3>
      </div>

      <div className="flex items-center justify-center gap-4 mb-4">
        <button
          onClick={() => setDividendYear((year) => year - 1)}
          className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <ChevronLeft className="w-5 h-5 text-slate-500" />
        </button>
        <span className="text-sm font-medium text-slate-700 min-w-[80px] text-center">
          {dividendYear}년
        </span>
        <button
          onClick={() => setDividendYear((year) => year + 1)}
          className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <ChevronRight className="w-5 h-5 text-slate-500" />
        </button>
      </div>

      <div className="h-[180px] mb-4">
        <Bar data={dividendChartData} options={dividendChartOptions} />
      </div>

      <div className="flex items-center justify-between pt-3 border-t border-slate-100">
        <span className="text-sm text-slate-600">
          {isCurrentYear ? '예상 연간 배당금' : '연간 배당금'}
        </span>
        <span className="text-lg font-bold text-red-500">
          {Math.round(totalDividend).toLocaleString()}원
        </span>
      </div>

      {isCurrentYear ? (
        <p className="mt-2 text-center text-[11px] text-slate-400">
          국내 주식·ETF의 현재 보유 수량 기준 예상치입니다.
        </p>
      ) : null}

      {isDividendLoading ? (
        <p className="text-xs text-slate-400 mt-2 text-center">배당금 정보 조회 중...</p>
      ) : totalDividend === 0 ? (
        <p className="text-xs text-slate-400 mt-2 text-center">
          {isCurrentYear
            ? stockHoldings.length === 0
              ? '배당을 지원하는 국내 종목이 없습니다'
              : '배당 정보를 계산할 수 있는 종목이 없습니다'
            : '저장된 배당 기록이 없습니다'}
        </p>
      ) : null}
    </div>
  );
}
