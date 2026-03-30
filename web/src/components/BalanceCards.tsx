'use client';

import { ComponentType, useEffect, useMemo, useState } from 'react';
import { Calendar, CalendarDays, CircleDollarSign, CreditCard, Wallet } from 'lucide-react';
import { useCategoryContext } from '@/contexts/CategoryContext';
import { subscribeToLocalCurrencyBalance, LocalCurrencyBalance } from '@/lib/balanceService';
import { Expense, TransactionType } from '@/types/expense';
import { HomeSummaryCardKey, HomeSummaryConfig } from '@/types/household';

interface BalanceCardsProps {
  currentYear: number;
  currentMonth: number;
  expenses: Expense[];
  yearlySpent: number | null;
  summaryConfig: HomeSummaryConfig;
  transactionType: TransactionType;
  className?: string;
  onLocalCurrencyClick?: (expenses: Expense[]) => void;
  onMonthlyIncomeClick?: (expenses: Expense[]) => void;
  onYearlyIncomeClick?: () => void;
}

interface SummaryCardContent {
  key: HomeSummaryCardKey | 'monthlyIncome' | 'yearlyIncome';
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
  transactionType,
  className = '',
  onLocalCurrencyClick,
  onMonthlyIncomeClick,
  onYearlyIncomeClick,
}: BalanceCardsProps) {
  const isIncome = transactionType === 'income';
  const { activeCategories } = useCategoryContext();
  const [localCurrencyBalance, setLocalCurrencyBalance] = useState<LocalCurrencyBalance | null>(null);

  const needsLocalCurrencyBalance = useMemo(() => {
    if (isIncome) {
      return false;
    }

    return (
      summaryConfig.leftCard === 'localCurrencyBalance' ||
      summaryConfig.rightCard === 'localCurrencyBalance'
    );
  }, [isIncome, summaryConfig.leftCard, summaryConfig.rightCard]);

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

  const handleMonthlyIncomeClick = () => {
    if (!onMonthlyIncomeClick) {
      return;
    }

    onMonthlyIncomeClick(expenses);
  };

  const handleYearlyIncomeClick = () => {
    if (!onYearlyIncomeClick) {
      return;
    }

    onYearlyIncomeClick();
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
          accentClassName: 'bg-blue-50 border-blue-100 text-blue-500',
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

  const incomeCards: SummaryCardContent[] = [
    {
      key: 'monthlyIncome',
      label: `${currentMonth}월 수입`,
      valueText: monthlySpent.toLocaleString(),
      accentClassName: 'bg-blue-50 border-blue-100 text-blue-500',
      icon: Calendar,
      iconClassName: 'text-pink-500',
      clickable: true,
    },
    {
      key: 'yearlyIncome',
      label: `${currentYear}년 수입`,
      valueText: yearlySpent !== null ? yearlySpent.toLocaleString() : '-',
      accentClassName: 'bg-emerald-50 border-emerald-100 text-emerald-500',
      icon: CalendarDays,
      iconClassName: 'text-pink-500',
      clickable: true,
    },
  ];

  const cards = isIncome
    ? incomeCards
    : [buildCardContent(summaryConfig.leftCard), buildCardContent(summaryConfig.rightCard)];

  return (
    <div className={`grid grid-cols-2 gap-2 ${className}`}>
      {cards.map((card) => {
        const Icon = card.icon;
        const handleCardClick =
          card.key === 'localCurrencyBalance'
            ? handleLocalCurrencyClick
            : card.key === 'monthlyIncome'
              ? handleMonthlyIncomeClick
              : card.key === 'yearlyIncome'
                ? handleYearlyIncomeClick
                : undefined;

        return (
          <div
            key={card.key}
            className={`balance-card-glass p-2.5 ${
              card.clickable ? 'cursor-pointer transition-shadow hover:shadow-lg' : ''
            }`}
            onClick={handleCardClick}
          >
            <div className="mb-1 flex items-center gap-1.5">
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full border ${card.accentClassName}`}
              >
                <Icon className="h-3.5 w-3.5" />
              </div>
              <span className="text-xs font-semibold text-slate-600">{card.label}</span>
            </div>
            <div className="flex items-center font-['Pretendard'] text-lg font-bold tracking-tight text-slate-800">
              {card.valueText}
              <CircleDollarSign className={`ml-1 h-4 w-4 ${card.iconClassName}`} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
