'use client';

import { memo, useMemo, useRef } from 'react';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, type ChartOptions } from 'chart.js';
import { Doughnut, getElementAtEvent } from 'react-chartjs-2';
import { Expense, Category } from '@/types/expense';
import { useCategoryContext } from '@/contexts/CategoryContext';
import { useChartMotion } from '@/components/common/useChartMotion';

ChartJS.register(ArcElement, Tooltip, Legend);

interface CategoryData {
  category: Category;
  label: string;
  color: string;
  amount: number;
  percentage: number;
}

interface DonutChartProps {
  expenses: Expense[];
  onCategoryClick: (category: Category) => void;
}

function DonutChart({ expenses, onCategoryClick }: DonutChartProps) {
  const { getCategoryLabel, getCategoryColor } = useCategoryContext();
  const chartMotion = useChartMotion();
  const chartRef = useRef<ChartJS<'doughnut'>>(null);

  const { chartData, categoryDataList, totalAmount } = useMemo(() => {
    // 카테고리별 합계 계산
    const categoryTotals = new Map<Category, number>();

    let totalAmount = 0;
    expenses.forEach((expense) => {
      const current = categoryTotals.get(expense.category) || 0;
      categoryTotals.set(expense.category, current + expense.amount);
      totalAmount += expense.amount;
    });

    // 금액이 있는 카테고리만 필터링하고 정렬
    const sortedCategories = Array.from(categoryTotals.entries())
      .filter(([_, amount]) => amount > 0)
      .sort((a, b) => b[1] - a[1]);

    const categoryDataList: CategoryData[] = sortedCategories.map(([cat, amount]) => ({
      category: cat,
      label: getCategoryLabel(cat),
      color: getCategoryColor(cat),
      amount,
      percentage: totalAmount > 0 ? Math.round((amount / totalAmount) * 100) : 0,
    }));

    return {
      chartData: {
        labels: categoryDataList.map(item => item.label),
        datasets: [
          {
            data: categoryDataList.map(item => item.amount),
            backgroundColor: categoryDataList.map(item => item.color),
            borderColor: '#ffffff',
            borderWidth: 2,
          },
        ],
      },
      categoryDataList,
      totalAmount,
    };
  }, [expenses, getCategoryLabel, getCategoryColor]);

  const options = useMemo<ChartOptions<'doughnut'>>(() => ({
    ...chartMotion,
    responsive: true,
    maintainAspectRatio: false,
    cutout: '65%',
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: context => ` ${context.parsed.toLocaleString()}원`,
        },
      },
    },
  }), [chartMotion]);

  const handleChartClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!chartRef.current) return;

    const elements = getElementAtEvent(chartRef.current, event);
    if (elements.length > 0) {
      onCategoryClick(categoryDataList[elements[0].index].category);
    }
  };

  return (
    <div className="flex flex-col md:flex-row items-center gap-4 w-full h-full">
      {/* 도넛 차트 */}
      <div className="relative w-48 h-48 flex-shrink-0">
        <Doughnut
          ref={chartRef}
          data={chartData}
          options={options}
          onClick={handleChartClick}
        />
        {/* 중앙 총액 표시 */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-xs text-slate-500">총 지출</span>
          <span className="text-lg font-bold text-slate-800">
            {totalAmount.toLocaleString()}
          </span>
          <span className="text-xs text-slate-500">원</span>
        </div>
      </div>

      {/* 범례 */}
      <div className="flex-1 space-y-2 w-full">
        {categoryDataList.map((data) => (
          <button
            key={data.category}
            onClick={() => onCategoryClick(data.category)}
            className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-slate-100 transition-colors text-left"
          >
            <div className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: data.color }}
              />
              <span className="text-sm text-slate-700">{data.label}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-800">
                {data.amount.toLocaleString()}원
              </span>
              <span className="text-xs text-slate-500 min-w-[36px] text-right">
                {data.percentage}%
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export default memo(DonutChart);
