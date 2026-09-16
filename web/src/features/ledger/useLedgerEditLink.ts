'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { Expense, TransactionType } from '@/types/expense';

/** 편집 링크 해석만 소유합니다. 이미 읽은 거래는 조회 없이 화면 탐색에 전달합니다. */
export function useLedgerEditLink({ expenses, ready, householdKey, transactionType, openExpense }: {
  expenses: readonly Expense[];
  ready: boolean;
  householdKey: string | null;
  transactionType: TransactionType;
  openExpense: (expense: Expense) => void;
}) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [editId, setEditId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const inMemory = expenses.find(expense => expense.id === editId);

  useEffect(() => {
    const id = searchParams.get('edit');
    if (!id) return;
    setEditId(id);
    setError('');
    router.replace(pathname, { scroll: false });
  }, [searchParams, router, pathname]);

  useEffect(() => {
    if (!editId || !ready || !householdKey) return;
    if (inMemory) {
      openExpense(inMemory);
      setEditId(null);
      return;
    }
    let cancelled = false;
    void import('@/lib/expenseService').then(({ getExpenseForEdit }) => {
      // 모듈 로딩 중 화면이나 가구가 바뀌었으면 새 세션으로 이전 요청을 보내지 않습니다.
      if (cancelled) return undefined;
      return getExpenseForEdit(editId);
    }).then(target => {
      if (cancelled) return;
      if (!target || target.transactionType !== transactionType) setError('지출을 찾을 수 없습니다.');
      else openExpense(target);
      setEditId(null);
    }).catch(() => {
      if (cancelled) return;
      setError('지출을 불러오지 못했습니다. 다시 열어 주세요.');
      setEditId(null);
    });
    return () => { cancelled = true; };
    // 목록의 무관한 갱신으로 진행 중인 단건 조회를 취소·재시작하지 않습니다.
  }, [editId, inMemory, ready, householdKey, transactionType, openExpense]);
  return error;
}
