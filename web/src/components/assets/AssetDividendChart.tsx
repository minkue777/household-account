'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { StockHolding } from '@/types/asset';
import { DividendSnapshotData, getAllStockHoldings, getDividendSnapshot } from '@/lib/assetService';
import { ModalOverlay } from '@/components/common';

interface DividendSnapshotEvent {
  stockCode: string;
  stockName: string;
  paymentDate: string;
  perShareAmount: number;
  quantity: number;
  totalAmount: number;
  recordDate?: string;
}

const CURRENT_YEAR = new Date().getFullYear();

function supportsDividendInfo(holding: StockHolding) {
  return (
    (holding.holdingType || 'stock') === 'stock' &&
    /^[A-Z0-9]+$/i.test((holding.stockCode || '').trim())
  );
}

function createEmptyMonthlyData() {
  return Array.from({ length: 12 }, () => 0);
}

export default function AssetDividendChart() {
  const [dividendYear, setDividendYear] = useState(CURRENT_YEAR);
  const [stockHoldings, setStockHoldings] = useState<StockHolding[]>([]);
  const [cachedDividendSnapshot, setCachedDividendSnapshot] = useState<DividendSnapshotData | null>(
    null
  );
  const [isDividendLoading, setIsDividendLoading] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);

  useEffect(() => {
    let isCancelled = false;

    const loadDividendData = async () => {
      setIsDividendLoading(true);

      try {
        const [allHoldings, snapshot] = await Promise.all([
          getAllStockHoldings(),
          getDividendSnapshot(dividendYear),
        ]);

        if (isCancelled) {
          return;
        }

        setStockHoldings(allHoldings.filter(supportsDividendInfo));
        setCachedDividendSnapshot(snapshot);
      } catch (error) {
        console.error('배당금 현황 조회 오류:', error);
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

      void loadDividendData();
    };

    void loadDividendData();
    window.addEventListener('focus', handleRefresh);
    document.addEventListener('visibilitychange', handleRefresh);

    return () => {
      isCancelled = true;
      window.removeEventListener('focus', handleRefresh);
      document.removeEventListener('visibilitychange', handleRefresh);
    };
  }, [dividendYear]);

  const isCurrentYear = dividendYear === CURRENT_YEAR;

  const monthlyDividendData = useMemo(() => {
    const monthlyTotals = cachedDividendSnapshot?.monthlyData || createEmptyMonthlyData();

    return monthlyTotals.map((dividend, index) => ({
      month: index + 1,
      dividend,
    }));
  }, [cachedDividendSnapshot]);

  const selectedMonthEvents = useMemo(() => {
    if (!selectedMonth) {
      return [];
    }

    return Object.values(cachedDividendSnapshot?.events || {})
      .filter((event) => {
        const [year, month] = event.paymentDate.split('-').map(Number);
        return year === dividendYear && month === selectedMonth;
      })
      .sort((left, right) => {
        if (left.paymentDate !== right.paymentDate) {
          return right.paymentDate.localeCompare(left.paymentDate);
        }

        return left.stockName.localeCompare(right.stockName, 'ko');
      }) as DividendSnapshotEvent[];
  }, [cachedDividendSnapshot?.events, dividendYear, selectedMonth]);

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
    onClick: (_event: unknown, elements: Array<{ index: number }>) => {
      const firstElement = elements[0];
      if (!firstElement) {
        return;
      }

      const month = firstElement.index + 1;
      const selectedData = monthlyDividendData[firstElement.index];
      if (!selectedData || selectedData.dividend <= 0) {
        return;
      }

      setSelectedMonth(month);
    },
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label(context: any) {
            return `${Math.round(Number(context.raw || 0)).toLocaleString()}원`;
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
          callback(value: string | number) {
            const numericValue = typeof value === 'number' ? value : Number(value);
            if (Math.abs(numericValue) >= 10000) {
              return (numericValue / 10000).toFixed(0);
            }
            return numericValue;
          },
        },
      },
    },
  };

  const totalDividend = monthlyDividendData.reduce((sum, item) => sum + item.dividend, 0);
  const selectedMonthLabel = selectedMonth ? `${selectedMonth}월` : '';
  const selectedMonthTotal = selectedMonthEvents.reduce((sum, event) => sum + event.totalAmount, 0);

  return (
    <>
      <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">배당금 현황</h3>
        </div>

        <div className="mb-4 flex items-center justify-center gap-4">
          <button
            onClick={() => {
              setDividendYear((year) => year - 1);
              setSelectedMonth(null);
            }}
            className="rounded-lg p-1 transition-colors hover:bg-slate-100"
          >
            <ChevronLeft className="h-5 w-5 text-slate-500" />
          </button>
          <span className="min-w-[80px] text-center text-sm font-medium text-slate-700">
            {dividendYear}년
          </span>
          <button
            onClick={() => {
              setDividendYear((year) => year + 1);
              setSelectedMonth(null);
            }}
            className="rounded-lg p-1 transition-colors hover:bg-slate-100"
          >
            <ChevronRight className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        <div className="mb-4 h-[180px]">
          <Bar data={dividendChartData} options={dividendChartOptions} />
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 pt-3">
          <span className="text-sm text-slate-600">
            {isCurrentYear ? '올해 누적 배당금' : '연간 배당금'}
          </span>
          <span className="text-lg font-bold text-red-500">
            {Math.round(totalDividend).toLocaleString()}원
          </span>
        </div>

        {isDividendLoading ? (
          <p className="mt-2 text-center text-xs text-slate-400">
            배당금 정보를 불러오는 중입니다.
          </p>
        ) : totalDividend === 0 ? (
          <p className="mt-2 text-center text-xs text-slate-400">
            {stockHoldings.length === 0
              ? '배당을 지원하는 국내 ETF 보유 종목이 없습니다'
              : '아직 저장된 배당 기록이 없습니다'}
          </p>
        ) : null}
      </div>

      {selectedMonth ? (
        <ModalOverlay onClose={() => setSelectedMonth(null)}>
          <div className="m-4 flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="text-lg font-bold text-slate-800">
                  {dividendYear}년 {selectedMonthLabel} 배당금
                </h3>
                <div className="mt-2 inline-flex items-baseline gap-2 rounded-xl bg-slate-50 px-3 py-2">
                  <span className="text-xs font-medium text-slate-500">총액</span>
                  <span className="text-xl font-semibold tracking-tight text-red-500">
                    {selectedMonthTotal.toLocaleString()}원
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedMonth(null)}
                className="rounded-lg p-2 transition-colors hover:bg-slate-100"
              >
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {selectedMonthEvents.length === 0 ? (
                <p className="py-12 text-center text-sm text-slate-400">
                  저장된 배당 상세 내역이 없습니다.
                </p>
              ) : (
                <div className="space-y-3">
                  {selectedMonthEvents.map((event, index) => (
                    <div
                      key={`${event.stockCode}_${event.paymentDate}_${event.perShareAmount}_${index}`}
                      className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold text-slate-800">{event.stockName}</p>
                          <p className="mt-1 text-xs text-slate-500">지급일 {event.paymentDate}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-emerald-600">
                            {event.totalAmount.toLocaleString()}원
                          </p>
                          <p className="mt-1 text-xs text-slate-500">배당금</p>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                        <div className="rounded-xl bg-white px-3 py-2">
                          <p className="text-slate-400">주당 배당금</p>
                          <p className="mt-1 font-medium text-slate-700">
                            {event.perShareAmount.toLocaleString()}원
                          </p>
                        </div>
                        <div className="rounded-xl bg-white px-3 py-2">
                          <p className="text-slate-400">수량</p>
                          <p className="mt-1 font-medium text-slate-700">
                            {event.quantity.toLocaleString()}주
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ModalOverlay>
      ) : null}
    </>
  );
}
