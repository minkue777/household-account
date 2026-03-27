'use client';

import { ComponentType, useEffect, useMemo, useState } from 'react';
import { Calendar, CalendarDays, CircleDollarSign, CreditCard, Wallet } from 'lucide-react';
import { useCategoryContext } from '@/contexts/CategoryContext';
import { subscribeToLocalCurrencyBalance, LocalCurrencyBalance } from '@/lib/balanceService';
import { Expense } from '@/types/expense';
import { HomeSummaryCardKey, HomeSummaryConfig } from '@/types/household';

interface BalanceCardsProps {
  currentYear: number;
  currentMonth: number;
  expenses: Expense[];
  yearlySpent: number | null;
  summaryConfig: HomeSummaryConfig;
  className?: string;
  onLocalCurrencyClick?: (expenses: Expense[]) => void;
}

interface SummaryCardContent {
  key: HomeSummaryCardKey;
  label: string;
  valueText: string;
  accentClassName: string;
  icon: ComponentType<{ className?: string }>;
  iconClassName: string;
  clickable?: boolean;
}

export default function BalanceCards({
  currentYear,
  currentMonth,
  expenses,
  yearlySpent,
  summaryConfig,
  className = '',
  onLocalCurrencyClick,
}: BalanceCardsProps) {
  const { activeCategories } = useCategoryContext();
  const [localCurrencyBalance, setLocalCurrencyBalance] = useState<LocalCurrencyBalance | null>(null);

  const needsLocalCurrencyBalance = useMemo(() => {
    return (
      summaryConfig.leftCard === 'localCurrencyBalance' ||
      summaryConfig.rightCard === 'localCurrencyBalance'
    );
  }, [summaryConfig.leftCard, summaryConfig.rightCard]);

  useEffect(() => {
    if (!needsLocalCurrencyBalance) {
      setLocalCurrencyBalance(null);
      return undefined;
    }

    const unsubscribe = subscribeToLocalCurrencyBalance(setLocalCurrencyBalance);
    return () => unsubscribe();
  }, [needsLocalCurrencyBalance]);

  const { remaining, isOverBudget, monthlySpent } = useMemo(() => {
    const budgetedCategoryKeys = new Set<string>();
    let totalBudget = 0;

    for (const category of activeCategories) {
      if (category.budget === null) {
        continue;
      }

      budgetedCategoryKeys.add(category.key);
      totalBudget += category.budget;
    }

    const budgetedSpent = expenses.reduce((sum, expense) => {
      if (!budgetedCategoryKeys.has(expense.category)) {
        return sum;
      }

      return sum + expense.amount;
    }, 0);
    const totalSpent = expenses.reduce((sum, expense) => sum + expense.amount, 0);
    const remainingBudget = totalBudget - budgetedSpent;

    return {
      remaining: remainingBudget,
      isOverBudget: remainingBudget < 0,
      monthlySpent: totalSpent,
    };
  }, [activeCategories, expenses]);

  const handleLocalCurrencyClick = () => {
    if (!onLocalCurrencyClick) {
      return;
    }

    const localCurrencyExpenses = expenses.filter((expense) => expense.cardType === 'local_currency');
    onLocalCurrencyClick(localCurrencyExpenses);
  };

  const buildCardContent = (key: HomeSummaryCardKey): SummaryCardContent => {
    switch (key) {
      case 'localCurrencyBalance':
        return {
          key,
          label: '지역화폐 잔액',
          valueText: localCurrencyBalance ? localCurrencyBalance.balance.toLocaleString() : '-',
          accentClassName: 'bg-blue-50 border-blue-100 text-blue-500',
          icon: CreditCard,
          iconClassName: 'text-yellow-500',
          clickable: true,
        };
      case 'monthlyRemainingBudget':
        return {
          key,
          label: `${currentMonth}월 잔여 예산`,
          valueText: `${isOverBudget ? '-' : ''}${Math.abs(remaining).toLocaleString()}`,
          accentClassName: isOverBudget
            ? 'bg-red-50 border-red-100 text-red-500'
            : 'bg-emerald-50 border-emerald-100 text-emerald-500',
          icon: Wallet,
          iconClassName: isOverBudget ? 'text-red-400' : 'text-yellow-500',
        };
      case 'monthlySpent':
        return {
          key,
          label: `${currentMonth}월 지출`,
          valueText: monthlySpent.toLocaleString(),
          accentClassName: 'bg-slate-100 border-slate-200 text-slate-600',
          icon: Calendar,
          iconClassName: 'text-yellow-500',
        };
      case 'yearlySpent':
        return {
          key,
          label: `${currentYear}년 지출`,
          valueText: yearlySpent !== null ? yearlySpent.toLocaleString() : '-',
          accentClassName: 'bg-sky-50 border-sky-100 text-sky-500',
          icon: CalendarDays,
          iconClassName: 'text-yellow-500',
        };
    }
  };

  const cards = [buildCardContent(summaryConfig.leftCard), buildCardContent(summaryConfig.rightCard)];

  return (
    <div className={`grid grid-cols-2 gap-2 ${className}`}>
      {cards.map((card) => {
        const Icon = card.icon;
        const isLocalCurrencyCard = card.key === 'localCurrencyBalance';

        return (
          <div
            key={card.key}
            className={`balance-card-glass p-2.5 ${
              card.clickable ? 'cursor-pointer hover:shadow-lg transition-shadow' : ''
            }`}
            onClick={isLocalCurrencyCard ? handleLocalCurrencyClick : undefined}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center border ${card.accentClassName}`}
              >
                <Icon className="w-3.5 h-3.5" />
              </div>
              <span className="text-xs font-semibold text-slate-600">{card.label}</span>
            </div>
            <div className="text-lg font-bold text-slate-800 tracking-tight font-['Pretendard'] flex items-center">
              {card.valueText}
              <CircleDollarSign className={`w-4 h-4 ml-1 ${card.iconClassName}`} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
