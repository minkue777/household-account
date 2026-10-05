'use client';

import { memo, useMemo } from 'react';
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
  type ChartData,
  type ChartOptions,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { Expense } from '@/types/expense';
import { useCategoryContext } from '@/contexts/CategoryContext';
import { useChartMotion } from '@/components/common/useChartMotion';

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
  enabledCategories: Set<string>;
  onCategoryToggle: (categories: Set<string>) => void;
}

function MonthlyTrendChart({ expenses, startDate, endDate, enabledCategories, onCategoryToggle }: MonthlyTrendChartProps) {
  const { activeCategories } = useCategoryContext();
  const chartMotion = useChartMotion();

  // 월별 라벨 생성
  const months = useMemo(() => {
    const result: string[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);

    const current = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    const endMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));

    while (current <= endMonth) {
      result.push(`${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, '0')}`);
      current.setUTCMonth(current.getUTCMonth() + 1);
    }

    return result;
  }, [startDate, endDate]);

  const series = useMemo(() => {
    const result = [
      { key: 'all', label: '전체', color: '#3B82F6' },
      ...activeCategories,
    ].map(({ key, label, color }) => ({ key, label, color, data: months.map(() => 0) }));
    const monthIndices = new Map(months.map((month, index) => [month, index]));
    const categorySeries = new Map(result.slice(1).map(item => [item.key, item]));

    for (const expense of expenses) {
      const index = monthIndices.get(expense.date.substring(0, 7));
      if (index === undefined) continue;
      result[0].data[index] += expense.amount;
      const category = categorySeries.get(expense.category);
      if (category) category.data[index] += expense.amount;
    }
    return result;
  }, [expenses, months, activeCategories]);

  const chartData = useMemo<ChartData<'line'>>(() => ({
    labels: months.map(monthKey => {
      const [year, month] = monthKey.split('-');
      return `${year.slice(2)}.${month}`;
    }),
    datasets: series.filter(item => enabledCategories.has(item.key)).map(item => {
      const isTotal = item.key === 'all';
      return {
        label: item.label,
        data: item.data,
        borderColor: item.color,
        backgroundColor: isTotal ? 'rgba(59, 130, 246, 0.1)' : `${item.color}20`,
        borderWidth: isTotal ? 3 : 2,
        fill: isTotal,
        tension: 0.3,
        pointRadius: isTotal ? 4 : 3,
        pointHoverRadius: isTotal ? 6 : 5,
      };
    }),
  }), [months, series, enabledCategories]);

  const options = useMemo<ChartOptions<'line'>>(() => ({
    ...chartMotion,
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
  }), [chartMotion]);

  // 토글 핸들러
  const toggleCategory = (key: string) => {
    const next = new Set(enabledCategories);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }

    onCategoryToggle(next);
  };

  return (
    <div className="space-y-4">
      {/* 카테고리 토글 버튼들 */}
      <div className="flex flex-wrap gap-2">
        {series.map(item => {
          const isTotal = item.key === 'all';
          const selected = enabledCategories.has(item.key);
          const selectedClass = isTotal ? 'bg-blue-500 text-white shadow-md' : 'text-white shadow-md';
          return (
            <button
              key={item.key}
              onClick={() => toggleCategory(item.key)}
              aria-pressed={selected}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                isTotal ? '' : 'flex items-center gap-1.5'
              } ${selected ? selectedClass : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
              style={isTotal ? undefined : { backgroundColor: selected ? item.color : undefined }}
            >
              {!isTotal && (
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: selected ? 'white' : item.color }}
                />
              )}
              {item.label}
            </button>
          );
        })}
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

export default memo(MonthlyTrendChart);
