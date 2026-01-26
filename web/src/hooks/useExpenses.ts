import { useState, useEffect, useMemo, useCallback } from 'react';
import { Expense } from '@/types/expense';
import {
  subscribeToMonthlyExpenses,
  updateExpense as updateExpenseService,
  addManualExpense,
  deleteExpense as deleteExpenseService,
  splitExpense as splitExpenseService,
  mergeExpenses as mergeExpensesService,
  unmergeExpense as unmergeExpenseService,
  SplitItem,
} from '@/lib/expenseService';

interface UseExpensesOptions {
  year: number;
  month: number;
}

interface UseExpensesReturn {
  expenses: Expense[];
  isLoading: boolean;
  // CRUD 함수
  updateExpense: (expenseId: string, data: { amount?: number; memo?: string; category?: string; merchant?: string }) => Promise<void>;
  addExpense: (merchant: string, amount: number, category: string, date: string, memo?: string) => Promise<string>;
  deleteExpense: (expenseId: string) => Promise<void>;
  splitExpense: (expense: Expense, splits: SplitItem[]) => Promise<string[]>;
  mergeExpenses: (targetExpense: Expense, sourceExpense: Expense) => Promise<void>;
  unmergeExpense: (expense: Expense) => Promise<string[]>;
  // 헬퍼 함수
  getExpensesByDate: (date: string) => Expense[];
  getExpensesByCategory: (category: string) => Expense[];
  getTotalAmount: () => number;
}

/**
 * 월별 지출 데이터 관리 훅
 * - 실시간 구독
 * - CRUD 작업
 * - 필터링 헬퍼
 */
export function useExpenses({ year, month }: UseExpensesOptions): UseExpensesReturn {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Firebase 실시간 구독
  useEffect(() => {
    setIsLoading(true);

    const unsubscribe = subscribeToMonthlyExpenses(
      year,
      month,
      (newExpenses) => {
        setExpenses(newExpenses);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [year, month]);

  // 지출 수정
  const updateExpense = useCallback(async (
    expenseId: string,
    data: { amount?: number; memo?: string; category?: string; merchant?: string }
  ) => {
    await updateExpenseService(expenseId, data);
  }, []);

  // 지출 추가
  const addExpense = useCallback(async (
    merchant: string,
    amount: number,
    category: string,
    date: string,
    memo?: string
  ) => {
    return addManualExpense(merchant, amount, category, date, memo);
  }, []);

  // 지출 삭제
  const deleteExpense = useCallback(async (expenseId: string) => {
    await deleteExpenseService(expenseId);
  }, []);

  // 지출 분할
  const splitExpense = useCallback(async (expense: Expense, splits: SplitItem[]) => {
    return splitExpenseService(expense, splits);
  }, []);

  // 지출 합치기
  const mergeExpenses = useCallback(async (targetExpense: Expense, sourceExpense: Expense) => {
    await mergeExpensesService(targetExpense, sourceExpense);
  }, []);

  // 합치기 되돌리기
  const unmergeExpense = useCallback(async (expense: Expense) => {
    return unmergeExpenseService(expense);
  }, []);

  // 날짜별 지출 필터
  const getExpensesByDate = useCallback((date: string) => {
    return expenses.filter((expense) => expense.date === date);
  }, [expenses]);

  // 카테고리별 지출 필터
  const getExpensesByCategory = useCallback((category: string) => {
    return expenses.filter((expense) => expense.category === category);
  }, [expenses]);

  // 총 지출 금액
  const getTotalAmount = useCallback(() => {
    return expenses.reduce((sum, expense) => sum + expense.amount, 0);
  }, [expenses]);

  return {
    expenses,
    isLoading,
    updateExpense,
    addExpense,
    deleteExpense,
    splitExpense,
    mergeExpenses,
    unmergeExpense,
    getExpensesByDate,
    getExpensesByCategory,
    getTotalAmount,
  };
}
