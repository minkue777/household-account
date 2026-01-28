'use client';

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
    const { remaining, totalBudget, percentage, isOverBudget } = useMemo(() => {
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
        const percentage = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;
        const isOverBudget = remaining < 0;

        return { remaining, totalBudget, percentage, isOverBudget };
    }, [expenses, getCategoryBudget]);

    return (
        <div className={`grid grid-cols-2 gap-3 ${className}`}>
            {/* 1. 경기지역화폐 카드 */}
            <div className="relative group overflow-hidden bg-white/60 backdrop-blur-xl border border-white/60 rounded-2xl p-4 shadow-sm transition-all hover:shadow-md hover:bg-white/80">
                <div className="flex flex-col h-full justify-between">
                    <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center border border-blue-100 text-blue-500">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                                </svg>
                            </div>
                            <span className="text-sm font-semibold text-slate-600">경기지역화폐</span>
                        </div>
                    </div>
                    <div>
                        <div className="text-2xl font-bold text-slate-800 tracking-tight">
                            784,694
                            <span className="text-sm font-medium text-slate-400 ml-1">원</span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1">이번 달 충전 혜택 완료</p>
                    </div>
                </div>

                {/* 장식용 그래픽 */}
                <div className="absolute -right-4 -top-4 w-20 h-20 bg-blue-400/10 rounded-full blur-2xl group-hover:bg-blue-400/20 transition-all" />
            </div>

            {/* 2. 남은 예산 카드 */}
            <div className={`relative group overflow-hidden bg-white/60 backdrop-blur-xl border border-white/60 rounded-2xl p-4 shadow-sm transition-all hover:shadow-md hover:bg-white/80`}>
                <div className="flex flex-col h-full justify-between">
                    <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center border ${isOverBudget
                                    ? 'bg-red-50 border-red-100 text-red-500'
                                    : 'bg-emerald-50 border-emerald-100 text-emerald-500'
                                }`}>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </div>
                            <span className="text-sm font-semibold text-slate-600">
                                {currentMonth}월 예산
                            </span>
                        </div>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isOverBudget
                                ? 'bg-red-100 text-red-600'
                                : 'bg-slate-100 text-slate-500'
                            }`}>
                            {percentage}%
                        </span>
                    </div>

                    <div>
                        <div className={`text-2xl font-bold tracking-tight flex items-baseline ${isOverBudget ? 'text-red-500' : 'text-slate-800'}`}>
                            {isOverBudget && '-'}
                            {Math.abs(remaining).toLocaleString()}
                            <span className={`text-sm font-medium ml-1 ${isOverBudget ? 'text-red-300' : 'text-slate-400'}`}>원</span>
                        </div>

                        {/* 프로그레스 바 */}
                        <div className="mt-3 relative w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                                className={`absolute left-0 top-0 h-full rounded-full transition-all duration-500 ease-out ${isOverBudget
                                        ? 'bg-red-500'
                                        : 'bg-gradient-to-r from-emerald-400 to-teal-500'
                                    }`}
                                style={{ width: `${Math.min(percentage, 100)}%` }}
                            />
                        </div>
                    </div>
                </div>

                {/* 장식용 그래픽 */}
                <div className={`absolute -right-4 -top-4 w-20 h-20 rounded-full blur-2xl transition-all ${isOverBudget ? 'bg-red-400/10 group-hover:bg-red-400/20' : 'bg-emerald-400/10 group-hover:bg-emerald-400/20'
                    }`} />
            </div>
        </div>
    );
}
