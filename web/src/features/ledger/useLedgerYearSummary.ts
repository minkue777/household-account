'use client';

import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { Expense, TransactionType } from '@/types/expense';

/** 연간 요약의 구독·실패·범위 폐기를 소유하며, 월 원장의 첫 표시 뒤에 시작합니다. */
export function useLedgerYearSummary({ year, transactionType, householdKey, enabled, ready, readRefreshKey }: {
  year: number;
  transactionType: TransactionType;
  householdKey: string | null;
  enabled: boolean;
  ready: boolean;
  readRefreshKey: string;
}) {
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [error, setError] = useState(false);

  useLayoutEffect(() => {
    setExpenses(null);
    setError(false);
  }, [year, transactionType, householdKey, enabled]);

  useEffect(() => {
    if (!enabled || !ready || !householdKey) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void import('@/lib/expenseService').then(({ subscribeToDateRangeExpenses }) => {
      if (cancelled) return;
      unsubscribe = subscribeToDateRangeExpenses(`${year}-01-01`, `${year}-12-31`, items => {
        if (cancelled) return;
        setExpenses(items);
        setError(false);
      }, {
        transactionType,
        // 같은 범위의 마지막 성공값은 남기고 실패를 유효한 0원으로 바꾸지 않습니다.
        onError: () => { if (!cancelled) setError(true); },
      });
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; unsubscribe?.(); };
  }, [enabled, ready, householdKey, year, transactionType, readRefreshKey]);

  const total = useMemo(() => expenses?.reduce((sum, expense) => sum + expense.amount, 0) ?? null, [expenses]);
  return { expenses: expenses ?? [], total, error };
}
