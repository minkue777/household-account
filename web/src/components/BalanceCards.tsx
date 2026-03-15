'use client';

import { useEffect, useMemo, useState } from 'react';
import { CircleDollarSign, CreditCard, Wallet } from 'lucide-react';
import { Expense } from '@/types/expense';
import { useCategoryContext } from '@/contexts/CategoryContext';
import { useTheme } from '@/contexts/ThemeContext';
import { LocalCurrencyBalance, subscribeToLocalCurrencyBalance } from '@/lib/balanceService';

interface BalanceCardsProps {
  currentMonth: number;
  expenses: Expense[];
  className?: string;
  onLocalCurrencyClick?: (expenses: Expense[]) => void;
}

export default function BalanceCards({
  currentMonth,
  expenses,
  className = '',
  onLocalCurrencyClick,
}: BalanceCardsProps) {
  const { getCategoryBudget } = useCategoryContext();
  const { themeConfig } = useTheme();
  const [localCurrencyBalance, setLocalCurrencyBalance] = useState<LocalCurrencyBalance | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToLocalCurrencyBalance(setLocalCurrencyBalance);
    return () => unsubscribe();
  }, []);

  const monthlyTotal = useMemo(
    () => expenses.reduce((sum, expense) => sum + expense.amount, 0),
    [expenses]
  );

  const spendingDays = useMemo(
    () => new Set(expenses.map((expense) => expense.date)).size,
    [expenses]
  );

  const { remaining, isOverBudget } = useMemo(() => {
    const foodBudget = getCategoryBudget('food') || 0;
    const livingBudget = getCategoryBudget('living') || 0;
    const childcareBudget = getCategoryBudget('childcare') || 0;
    const fixedBudget = getCategoryBudget('fixed') || 0;
    const totalBudget = foodBudget + livingBudget + childcareBudget + fixedBudget;

    const totalSpent = expenses
      .filter((expense) => ['food', 'living', 'childcare', 'fixed'].includes(expense.category))
      .reduce((sum, expense) => sum + expense.amount, 0);

    return {
      remaining: totalBudget - totalSpent,
      isOverBudget: totalBudget - totalSpent < 0,
    };
  }, [expenses, getCategoryBudget]);

  const handleLocalCurrencyClick = () => {
    if (!onLocalCurrencyClick) return;

    const localCurrencyExpenses = expenses.filter((expense) => expense.cardType === 'local_currency');
    onLocalCurrencyClick(localCurrencyExpenses);
  };

  return (
    <section className={`space-y-3 ${className}`}>
      <div className="balance-card-glass relative overflow-hidden p-4 md:p-5">
        <div
          className="absolute inset-x-0 top-0 h-1"
          style={{ background: themeConfig.titleGradient }}
        />
        <div
          className="absolute -right-8 -top-8 h-28 w-28 rounded-full opacity-20 blur-3xl"
          style={{ background: themeConfig.titleGradient }}
        />

        <div className="relative flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-900/[0.04] px-3 py-1 text-[11px] font-medium text-slate-500">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: themeConfig.accent }}
              />
              {currentMonth}월 총지출
            </div>

            <div className="mt-3 flex items-end gap-2">
              <span className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900">
                {monthlyTotal.toLocaleString()}
              </span>
              <span className="pb-1 text-sm font-medium text-slate-400">원</span>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="rounded-full border border-slate-200 bg-white/80 px-2.5 py-1">
                {expenses.length.toLocaleString()}건 등록
              </span>
              <span className="rounded-full border border-slate-200 bg-white/80 px-2.5 py-1">
                {spendingDays.toLocaleString()}일 지출
              </span>
            </div>
          </div>

          <div className="relative flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-white/80 shadow-sm ring-1 ring-slate-200/70">
            <CircleDollarSign
              className="h-6 w-6"
              style={{ color: themeConfig.accent }}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="balance-card-glass p-3.5">
          <div className="flex items-center gap-2 mb-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-xl border ${
                isOverBudget
                  ? 'border-red-200 bg-red-50 text-red-500'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-500'
              }`}
            >
              <Wallet className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-500">남은 예산</div>
              <div className="text-[11px] text-slate-400">
                {isOverBudget ? '예산 초과 상태' : '이번 달 예산 잔액'}
              </div>
            </div>
          </div>

          <div className={`flex items-end gap-1.5 ${isOverBudget ? 'text-red-500' : 'text-slate-900'}`}>
            <span className="text-xl font-bold tracking-tight">
              {isOverBudget && '-'}
              {Math.abs(remaining).toLocaleString()}
            </span>
            <span className="pb-0.5 text-xs font-medium text-slate-400">원</span>
          </div>
        </div>

        <button
          type="button"
          className="balance-card-glass p-3.5 text-left transition-all hover:shadow-lg"
          onClick={handleLocalCurrencyClick}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-blue-200 bg-blue-50 text-blue-500">
              <CreditCard className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-500">지역화폐 잔액</div>
              <div className="text-[11px] text-slate-400">터치해서 사용내역 보기</div>
            </div>
          </div>

          <div className="flex items-end gap-1.5 text-slate-900">
            <span className="text-xl font-bold tracking-tight">
              {localCurrencyBalance ? localCurrencyBalance.balance.toLocaleString() : '-'}
            </span>
            <span className="pb-0.5 text-xs font-medium text-slate-400">원</span>
          </div>
        </button>
      </div>
    </section>
  );
}
