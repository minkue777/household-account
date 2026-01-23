'use client';

import { useMemo } from 'react';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';
import { Expense, Category } from '@/types/expense';
import { useCategoryContext } from '@/contexts/CategoryContext';

ChartJS.register(ArcElement, Tooltip, Legend);

interface DonutChartProps {
  expenses: Expense[];
}

export default function DonutChart({ expenses }: DonutChartProps) {
  const { getCategoryLabel, getCategoryColor } = useCategoryContext();

  const chartData = useMemo(() => {
    // 카테고리별 합계 계산
    const categoryTotals = new Map<Category, number>();

    expenses.forEach((expense) => {
      const current = categoryTotals.get(expense.category) || 0;
      categoryTotals.set(expense.category, current + expense.amount);
    });

    // 금액이 있는 카테고리만 필터링하고 정렬
    const sortedCategories = Array.from(categoryTotals.entries())
      .filter(([_, amount]) => amount > 0)
      .sort((a, b) => b[1] - a[1]);

    const labels = sortedCategories.map(([cat]) => getCategoryLabel(cat));
    const data = sortedCategories.map(([_, amount]) => amount);
    const backgroundColor = sortedCategories.map(([cat]) => getCategoryColor(cat));

    return {
      labels,
      datasets: [
        {
          data,
          backgroundColor,
          borderColor: '#ffffff',
          borderWidth: 2,
        },
      ],
    };
  }, [expenses, getCategoryLabel, getCategoryColor]);

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '65%',
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: function (context: any) {
            const value = context.parsed;
            return ` ${value.toLocaleString()}원`;
          },
        },
      },
    },
  };

  const totalAmount = expenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <Doughnut data={chartData} options={options} />
      {/* 중앙 총액 표시 */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-xs text-slate-500">총 지출</span>
        <span className="text-lg font-bold text-slate-800">
          {totalAmount.toLocaleString()}
        </span>
        <span className="text-xs text-slate-500">원</span>
      </div>
    </div>
  );
}
