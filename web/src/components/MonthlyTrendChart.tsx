'use client';

import { useMemo, useState } from 'react';
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
import { Expense } from '@/types/expense';
import { useCategoryContext } from '@/contexts/CategoryContext';

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

interface MonthlyTrendChartProps {
  expenses: Expense[];
  startDate: string;  // YYYY-MM-DD
  endDate: string;    // YYYY-MM-DD
}

export default function MonthlyTrendChart({ expenses, startDate, endDate }: MonthlyTrendChartProps) {
  const { activeCategories, getCategoryColor, getCategoryLabel } = useCategoryContext();

  // 토글 상태: 'all' + 각 카테고리 key
  const [enabledCategories, setEnabledCategories] = useState<Set<string>>(() => {
    const initial = new Set<string>(['all']);
    return initial;
  });

  // 월별 라벨 생성
  const months = useMemo(() => {
    const result: string[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);

    const current = new Date(start.getFullYear(), start.getMonth(), 1);
    const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);

    while (current <= endMonth) {
      result.push(`${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`);
      current.setMonth(current.getMonth() + 1);
    }

    return result;
  }, [startDate, endDate]);

  // 월별 데이터 집계
  const monthlyData = useMemo(() => {
    // 전체 합계
    const allData: Record<string, number> = {};
    // 카테고리별 합계
    const categoryData: Record<string, Record<string, number>> = {};

    // 초기화
    months.forEach((month) => {
      allData[month] = 0;
      activeCategories.forEach((cat) => {
        if (!categoryData[cat.key]) {
          categoryData[cat.key] = {};
        }
        categoryData[cat.key][month] = 0;
      });
    });

    // 데이터 집계
    expenses.forEach((expense) => {
      const month = expense.date.substring(0, 7); // YYYY-MM
      if (allData[month] !== undefined) {
        allData[month] += expense.amount;

        if (categoryData[expense.category]?.[month] !== undefined) {
          categoryData[expense.category][month] += expense.amount;
        }
      }
    });

    return { allData, categoryData };
  }, [expenses, months, activeCategories]);

  // 차트 데이터
  const chartData = useMemo(() => {
    const datasets: any[] = [];

    // 'All' 데이터셋
    if (enabledCategories.has('all')) {
      datasets.push({
        label: '전체',
        data: months.map((m) => monthlyData.allData[m]),
        borderColor: '#3B82F6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        borderWidth: 3,
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointHoverRadius: 6,
      });
    }

    // 카테고리별 데이터셋
    activeCategories.forEach((cat) => {
      if (enabledCategories.has(cat.key)) {
        datasets.push({
          label: cat.label,
          data: months.map((m) => monthlyData.categoryData[cat.key]?.[m] ?? 0),
          borderColor: cat.color,
          backgroundColor: `${cat.color}20`,
          borderWidth: 2,
          fill: false,
          tension: 0.3,
          pointRadius: 3,
          pointHoverRadius: 5,
        });
      }
    });

    return {
      labels: months.map((m) => {
        const [year, month] = m.split('-');
        return `${year.slice(2)}.${month}`;
      }),
      datasets,
    };
  }, [months, monthlyData, enabledCategories, activeCategories]);

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
    plugins: {
      legend: {
        display: false,
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
        beginAtZero: true,
        ticks: {
          callback: function (value: any) {
            if (value >= 10000) {
              return `${(value / 10000).toFixed(0)}만`;
            }
            return value.toLocaleString();
          },
        },
      },
    },
  };

  // 토글 핸들러
  const toggleCategory = (key: string) => {
    setEnabledCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* 카테고리 토글 버튼들 */}
      <div className="flex flex-wrap gap-2">
        {/* All 버튼 */}
        <button
          onClick={() => toggleCategory('all')}
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
            enabledCategories.has('all')
              ? 'bg-blue-500 text-white shadow-md'
              : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
          }`}
        >
          전체
        </button>

        {/* 카테고리 버튼들 */}
        {activeCategories.map((cat) => (
          <button
            key={cat.key}
            onClick={() => toggleCategory(cat.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all flex items-center gap-1.5 ${
              enabledCategories.has(cat.key)
                ? 'text-white shadow-md'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
            style={{
              backgroundColor: enabledCategories.has(cat.key) ? cat.color : undefined,
            }}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: enabledCategories.has(cat.key) ? 'white' : cat.color }}
            />
            {cat.label}
          </button>
        ))}
      </div>

      {/* 차트 */}
      <div className="h-72">
        {chartData.datasets.length > 0 ? (
          <Line data={chartData} options={options} />
        ) : (
          <div className="h-full flex items-center justify-center text-slate-400">
            카테고리를 선택하세요
          </div>
        )}
      </div>
    </div>
  );
}
