'use client';

import { useState, useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';
import { AssetHistoryEntry } from '@/types/asset';

type ProfitViewType = 'monthly' | 'daily';

interface AssetProfitChartProps {
  totalSnapshots: AssetHistoryEntry[];
  totalAssets: number;
}

export default function AssetProfitChart({ totalSnapshots, totalAssets }: AssetProfitChartProps) {
  const [profitView, setProfitView] = useState<ProfitViewType>('daily');
  const [profitYear, setProfitYear] = useState(new Date().getFullYear());
  const [profitMonth, setProfitMonth] = useState(new Date().getMonth() + 1);
  const [showProfitTable, setShowProfitTable] = useState(false);

  // 월별 수익 데이터 계산
  const monthlyProfitData = useMemo(() => {
    const monthlyData: { month: number; profit: number; rate: number }[] = [];

    for (let month = 1; month <= 12; month++) {
      const startDate = `${profitYear}-${String(month).padStart(2, '0')}-01`;
      const endDate = `${profitYear}-${String(month).padStart(2, '0')}-31`;

      const monthSnapshots = totalSnapshots.filter(
        (h) => h.date >= startDate && h.date <= endDate
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
  }, [totalSnapshots, profitYear, totalAssets]);

  // 일별 수익 데이터 계산
  const dailyProfitData = useMemo(() => {
    const daysInMonth = new Date(profitYear, profitMonth, 0).getDate();
    const dailyData: { day: number; profit: number; rate: number }[] = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${profitYear}-${String(profitMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      const daySnapshot = totalSnapshots.find((h) => h.date === dateStr);

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
  }, [totalSnapshots, profitYear, profitMonth]);

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

  return (
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
              <div className="space-y-0.5">
                {/* 테이블 헤더 */}
                <div className="grid grid-cols-[minmax(0,1fr)_84px_112px] items-center gap-4 border-b border-slate-100 py-1.5 text-xs text-slate-500">
                  <span>{profitView === 'monthly' ? '월' : '일'}</span>
                  <span className="text-right">수익률</span>
                  <span className="text-right">수익</span>
                </div>
                {/* 테이블 바디 */}
                {profitTableData.map((item) => (
                  <div
                    key={profitView === 'monthly' ? (item as any).month : (item as any).day}
                    className="grid grid-cols-[minmax(0,1fr)_84px_112px] items-center gap-4 py-1.5 text-sm"
                  >
                    <span className="text-slate-700">
                      {profitView === 'monthly'
                        ? `${(item as any).month}월`
                        : `${(item as any).day}일`}
                    </span>
                    <span
                      className={`text-right font-medium ${
                        item.profit >= 0 ? 'text-red-500' : 'text-blue-500'
                      }`}
                    >
                      {item.profit >= 0 ? '+' : ''}
                      {item.rate.toFixed(2)}%
                    </span>
                    <span
                      className={`text-right font-medium ${
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
  );
}
