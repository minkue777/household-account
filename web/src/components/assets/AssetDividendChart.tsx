'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { StockHolding } from '@/types/asset';
import {
  DividendSnapshotData,
  getAllStockHoldings,
  getDividendSnapshot,
  mergeDividendSnapshotEvents,
} from '@/lib/assetService';
import { ModalOverlay } from '@/components/common';

interface DividendInfo {
  code: string;
  name: string;
  recentDividend: number | null;
  paymentDate: string | null;
  frequency: number | null;
  dividendYield: number | null;
  annualDividendPerShare: number | null;
  isEstimated: boolean;
  paymentEvents: Array<{
    paymentDate: string;
    dividend: number;
  }>;
}

const CURRENT_YEAR = new Date().getFullYear();

function supportsDividendInfo(holding: StockHolding) {
  return (holding.holdingType || 'stock') === 'stock' && /^\d+$/.test(holding.stockCode || '');
}

function isPastOrToday(dateText: string) {
  const target = new Date(`${dateText}T00:00:00`);
  if (!Number.isFinite(target.getTime())) {
    return false;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return target.getTime() <= today.getTime();
}

function createEmptyMonthlyData() {
  return Array.from({ length: 12 }, () => 0);
}

export default function AssetDividendChart() {
  const [dividendYear, setDividendYear] = useState(CURRENT_YEAR);
  const [stockHoldings, setStockHoldings] = useState<StockHolding[]>([]);
  const [dividendInfoMap, setDividendInfoMap] = useState<Record<string, DividendInfo>>({});
  const [isDividendLoading, setIsDividendLoading] = useState(false);
  const [cachedDividendSnapshot, setCachedDividendSnapshot] = useState<DividendSnapshotData | null>(
    null
  );
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);

  useEffect(() => {
    const fetchCachedDividend = async () => {
      const cached = await getDividendSnapshot(dividendYear);
      setCachedDividendSnapshot(cached);
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

  useEffect(() => {
    if (dividendYear !== CURRENT_YEAR || isDividendLoading || stockHoldings.length === 0) {
      return;
    }

    const quantityByStock: Record<string, { quantity: number; name: string }> = {};

    stockHoldings.forEach((holding) => {
      if (!supportsDividendInfo(holding)) {
        return;
      }

      const current = quantityByStock[holding.stockCode] || {
        quantity: 0,
        name: holding.stockName,
      };
      current.quantity += holding.quantity || 0;
      current.name = holding.stockName;
      quantityByStock[holding.stockCode] = current;
    });

    const newEvents = Object.entries(quantityByStock).reduce<
      Record<
        string,
        {
          stockCode: string;
          stockName: string;
          paymentDate: string;
          perShareAmount: number;
          quantity: number;
          totalAmount: number;
        }
      >
    >((acc, [stockCode, stock]) => {
      const dividendInfo = dividendInfoMap[stockCode];

      if (!dividendInfo?.paymentEvents?.length || stock.quantity <= 0) {
        return acc;
      }

      dividendInfo.paymentEvents.forEach((event) => {
        if (!event.paymentDate.startsWith(`${CURRENT_YEAR}-`)) {
          return;
        }

        if (!isPastOrToday(event.paymentDate) || event.dividend <= 0) {
          return;
        }

        const eventKey = `${stockCode}_${event.paymentDate}_${event.dividend}`;
        acc[eventKey] = {
          stockCode,
          stockName: stock.name,
          paymentDate: event.paymentDate,
          perShareAmount: event.dividend,
          quantity: stock.quantity,
          totalAmount: event.dividend * stock.quantity,
        };
      });

      return acc;
    }, {});

    void (async () => {
      const merged = await mergeDividendSnapshotEvents(dividendYear, newEvents);
      if (merged) {
        setCachedDividendSnapshot(merged);
      }
    })();
  }, [dividendInfoMap, dividendYear, isDividendLoading, stockHoldings]);

  const isCurrentYear = dividendYear === CURRENT_YEAR;

  const monthlyDividendData = useMemo(() => {
    const hasStoredEvents = Object.keys(cachedDividendSnapshot?.events || {}).length > 0;
    const monthlyTotals =
      isCurrentYear && !hasStoredEvents
        ? createEmptyMonthlyData()
        : cachedDividendSnapshot?.monthlyData || createEmptyMonthlyData();

    return monthlyTotals.map((dividend, index) => ({
      month: index + 1,
      dividend,
    }));
  }, [cachedDividendSnapshot, isCurrentYear]);

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
      });
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
  const selectedMonthLabel = selectedMonth ? `${selectedMonth}월` : '';
  const selectedMonthTotal = selectedMonthEvents.reduce((sum, event) => sum + event.totalAmount, 0);

  return (
    <>
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-700">배당금 현황</h3>
        </div>

        <div className="flex items-center justify-center gap-4 mb-4">
          <button
            onClick={() => {
              setDividendYear((year) => year - 1);
              setSelectedMonth(null);
            }}
            className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-slate-500" />
          </button>
          <span className="text-sm font-medium text-slate-700 min-w-[80px] text-center">
            {dividendYear}년
          </span>
          <button
            onClick={() => {
              setDividendYear((year) => year + 1);
              setSelectedMonth(null);
            }}
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
            {isCurrentYear ? '올해 누적 배당금' : '연간 배당금'}
          </span>
          <span className="text-lg font-bold text-red-500">
            {Math.round(totalDividend).toLocaleString()}원
          </span>
        </div>

        {isCurrentYear ? (
          <p className="mt-2 text-center text-[11px] text-slate-400">
            실제 지급월 기준으로 저장된 ETF 배당금입니다.
          </p>
        ) : null}

        {totalDividend > 0 ? (
          <p className="mt-1 text-center text-[11px] text-slate-400">
            막대를 누르면 해당 월 상세 내역을 볼 수 있습니다.
          </p>
        ) : null}

        {isDividendLoading ? (
          <p className="text-xs text-slate-400 mt-2 text-center">배당금 정보 조회 중...</p>
        ) : totalDividend === 0 ? (
          <p className="text-xs text-slate-400 mt-2 text-center">
            {isCurrentYear
              ? stockHoldings.length === 0
                ? '배당을 지원하는 국내 종목이 없습니다'
                : '아직 저장된 ETF 배당 기록이 없습니다'
              : '저장된 배당 기록이 없습니다'}
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
                <p className="mt-1 text-sm text-slate-500">
                  총 {selectedMonthTotal.toLocaleString()}원
                </p>
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
                          <p className="mt-1 text-xs text-slate-500">총 배당금</p>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-600">
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
                        <div className="rounded-xl bg-white px-3 py-2">
                          <p className="text-slate-400">계산식</p>
                          <p className="mt-1 font-medium text-slate-700">
                            {event.perShareAmount.toLocaleString()} × {event.quantity.toLocaleString()}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-slate-100 px-5 py-4">
              <div className="flex items-center justify-between rounded-2xl bg-emerald-50 px-4 py-3">
                <span className="text-sm font-medium text-slate-700">{selectedMonthLabel} 총 배당금</span>
                <span className="text-lg font-bold text-emerald-600">
                  {selectedMonthTotal.toLocaleString()}원
                </span>
              </div>
            </div>
          </div>
        </ModalOverlay>
      ) : null}
    </>
  );
}
