'use client';

// 잔액 카드 컴포넌트
import { useMemo } from 'react';
import { Expense } from '@/types/expense';
import { useCategoryContext } from '@/contexts/CategoryContext';

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
            <div className="bg-white/80 backdrop-blur-xl border border-white/60 rounded-xl p-2.5 shadow-md">
                <div className="flex items-center gap-1.5 mb-1">
                    <div className="w-6 h-6 rounded-full bg-blue-50 flex items-center justify-center border border-blue-100 text-blue-500">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                        </svg>
                    </div>
                    <span className="text-xs font-semibold text-slate-600">경기지역화폐</span>
                </div>
                <div className="text-lg font-bold text-slate-800 tracking-tight font-[family-name:var(--font-inter)]">
                    784,694<span className="text-xs font-medium text-slate-400 ml-0.5">원</span>
                </div>
            </div>

            {/* 2. 남은 예산 카드 */}
            <div className="bg-white/80 backdrop-blur-xl border border-white/60 rounded-xl p-2.5 shadow-md">
                <div className="flex items-center gap-1.5 mb-1">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center border ${isOverBudget
                            ? 'bg-red-50 border-red-100 text-red-500'
                            : 'bg-emerald-50 border-emerald-100 text-emerald-500'
                        }`}>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                    <span className="text-xs font-semibold text-slate-600">
                        {currentMonth}월 예산
                    </span>
                </div>
                <div className={`text-lg font-bold tracking-tight font-[family-name:var(--font-inter)] ${isOverBudget ? 'text-red-500' : 'text-slate-800'}`}>
                    {isOverBudget && '-'}{Math.abs(remaining).toLocaleString()}<span className={`text-xs font-medium ml-0.5 ${isOverBudget ? 'text-red-300' : 'text-slate-400'}`}>원</span>
                </div>
            </div>
        </div>
    );
}
