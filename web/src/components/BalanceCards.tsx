'use client';

// 잔액 카드 컴포넌트
import { useMemo, useState, useEffect } from 'react';
import { Expense } from '@/types/expense';
import { useCategoryContext } from '@/contexts/CategoryContext';
import { CircleDollarSign, CreditCard, Wallet } from 'lucide-react';
import { subscribeToLocalCurrencyBalance, LocalCurrencyBalance } from '@/lib/balanceService';

interface BalanceCardsProps {
    currentMonth: number;
    expenses: Expense[];
    className?: string;
}

export default function BalanceCards({
    currentMonth,
    expenses,
    className = '',
}: BalanceCardsProps) {
    const { getCategoryBudget } = useCategoryContext();
    const [localCurrencyBalance, setLocalCurrencyBalance] = useState<LocalCurrencyBalance | null>(null);

    // 지역화폐 잔액 구독
    useEffect(() => {
        const unsubscribe = subscribeToLocalCurrencyBalance(setLocalCurrencyBalance);
        return () => unsubscribe();
    }, []);

    // 예산 상태 계산
    const { remaining, isOverBudget } = useMemo(() => {
        const foodBudget = getCategoryBudget('food') || 0;
        const livingBudget = getCategoryBudget('living') || 0;
        const childcareBudget = getCategoryBudget('childcare') || 0;
        const fixedBudget = getCategoryBudget('fixed') || 0;
        const totalBudget = foodBudget + livingBudget + childcareBudget + fixedBudget;

        const foodSpent = expenses.filter(e => e.category === 'food').reduce((sum, e) => sum + e.amount, 0);
        const livingSpent = expenses.filter(e => e.category === 'living').reduce((sum, e) => sum + e.amount, 0);
        const childcareSpent = expenses.filter(e => e.category === 'childcare').reduce((sum, e) => sum + e.amount, 0);
        const fixedSpent = expenses.filter(e => e.category === 'fixed').reduce((sum, e) => sum + e.amount, 0);
        const totalSpent = foodSpent + livingSpent + childcareSpent + fixedSpent;

        const remaining = totalBudget - totalSpent;
        const isOverBudget = remaining < 0;

        return { remaining, isOverBudget };
    }, [expenses, getCategoryBudget]);

    return (
        <div className={`grid grid-cols-2 gap-2 ${className}`}>
            {/* 1. 경기지역화폐 카드 */}
            <div className="balance-card-glass p-2.5">
                <div className="flex items-center gap-1.5 mb-1">
                    <div className="w-6 h-6 rounded-full bg-blue-50 flex items-center justify-center border border-blue-100 text-blue-500">
                        <CreditCard className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-xs font-semibold text-slate-600">경기지역화폐</span>
                </div>
                <div className="text-lg font-bold text-slate-800 tracking-tight font-['Pretendard'] flex items-center">
                    {localCurrencyBalance ? localCurrencyBalance.balance.toLocaleString() : '-'}
                    <CircleDollarSign className="w-4 h-4 ml-1 text-yellow-500" />
                </div>
            </div>

            {/* 2. 남은 예산 카드 */}
            <div className="balance-card-glass p-2.5">
                <div className="flex items-center gap-1.5 mb-1">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center border ${isOverBudget
                            ? 'bg-red-50 border-red-100 text-red-500'
                            : 'bg-emerald-50 border-emerald-100 text-emerald-500'
                        }`}>
                        <Wallet className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-xs font-semibold text-slate-600">
                        {currentMonth}월 잔여 예산
                    </span>
                </div>
                <div className={`text-lg font-bold tracking-tight font-['Pretendard'] flex items-center ${isOverBudget ? 'text-red-500' : 'text-slate-800'}`}>
                    {isOverBudget && '-'}{Math.abs(remaining).toLocaleString()}
                    <CircleDollarSign className="w-4 h-4 ml-1 text-yellow-500" />
                </div>
            </div>
        </div>
    );
}
