'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, X } from 'lucide-react';
import { Portal } from '@/components/common';
import { Expense } from '@/types/expense';
import { getLedgerPrimaryText, getLedgerSecondaryText } from '@/lib/utils/ledgerDisplay';
import ExpenseEditModal from './ExpenseEditModal';

type IncomeSummaryMode = 'monthly' | 'yearly';

interface MonthlyGroup {
  yearMonth: string;
  label: string;
  expenses: Expense[];
  total: number;
}

interface IncomeSummaryModalProps {
  isOpen: boolean;
  mode: IncomeSummaryMode;
  expenses: Expense[];
  currentYear: number;
  currentMonth: number;
  onClose: () => void;
  onExpenseUpdate?: (
    expenseId: string,
    data: { amount?: number; memo?: string; category?: string; merchant?: string; date?: string }
  ) => Promise<void> | void;
  onDelete?: (expenseId: string) => Promise<void> | void;
}

function compareExpenses(a: Expense, b: Expense) {
  const dateCompare = b.date.localeCompare(a.date);
  if (dateCompare !== 0) {
    return dateCompare;
  }

  return (b.time || '').localeCompare(a.time || '');
}

export default function IncomeSummaryModal({
  isOpen,
  mode,
  expenses,
  currentYear,
  currentMonth,
  onClose,
  onExpenseUpdate,
  onDelete,
}: IncomeSummaryModalProps) {
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  const sortedExpenses = useMemo(() => [...expenses].sort(compareExpenses), [expenses]);

  const groupedExpenses = useMemo<MonthlyGroup[]>(() => {
    return sortedExpenses.reduce<MonthlyGroup[]>((groups, expense) => {
      const yearMonth = expense.date.slice(0, 7);
      const existingGroup = groups.find((group) => group.yearMonth === yearMonth);

      if (existingGroup) {
        existingGroup.expenses.push(expense);
        existingGroup.total += expense.amount;
        return groups;
      }

      const [year, month] = yearMonth.split('-');
      groups.push({
        yearMonth,
        label: `${year}년 ${Number.parseInt(month, 10)}월`,
        expenses: [expense],
        total: expense.amount,
      });
      return groups;
    }, []);
  }, [sortedExpenses]);

  const totalAmount = useMemo(
    () => sortedExpenses.reduce((sum, expense) => sum + expense.amount, 0),
    [sortedExpenses]
  );

  const title = mode === 'monthly' ? `${currentMonth}월 수입 내역` : `${currentYear}년 수입 내역`;

  useEffect(() => {
    if (!isOpen) {
      setSelectedExpense(null);
      setExpandedMonth(null);
      return;
    }

    if (mode === 'yearly') {
      setExpandedMonth(groupedExpenses[0]?.yearMonth ?? null);
      return;
    }

    setExpandedMonth(null);
  }, [groupedExpenses, isOpen, mode]);

  const handleSaveEdit = async (updates: {
    amount?: number;
    memo?: string;
    category?: string;
    merchant?: string;
    date?: string;
  }) => {
    if (!selectedExpense || !onExpenseUpdate) {
      return;
    }

    await onExpenseUpdate(selectedExpense.id, updates);
  };

  const handleDeleteExpense = async () => {
    if (!selectedExpense || !onDelete) {
      return;
    }

    await onDelete(selectedExpense.id);
    setSelectedExpense(null);
  };

  const renderExpenseRow = (expense: Expense) => {
    const primaryText = getLedgerPrimaryText(expense, 'income');
    const secondaryText = getLedgerSecondaryText(expense, 'income');

    return (
      <div
        key={expense.id}
        onClick={() => setSelectedExpense(expense)}
        className="flex cursor-pointer items-center justify-between p-3 transition-colors hover:bg-slate-50"
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500 text-xs font-medium text-white">
            수입
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-slate-800">{primaryText}</div>
            <div className="text-xs text-slate-500">
              {expense.date}
              {secondaryText ? ` · ${secondaryText}` : ''}
            </div>
          </div>
        </div>
        <div className="ml-3 flex-shrink-0 font-semibold text-slate-800">
          {expense.amount.toLocaleString()}원
        </div>
      </div>
    );
  };

  if (!isOpen) {
    return null;
  }

  return (
    <>
      <Portal>
        <div
          className="fixed inset-0 z-[9999] flex items-start justify-center bg-slate-900/30 px-4 pt-12 backdrop-blur-sm md:pt-20"
          onClick={onClose}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-slate-100 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {sortedExpenses.length}건 · {totalAmount.toLocaleString()}원
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="rounded-xl p-3 transition-colors hover:bg-slate-100"
                  aria-label="닫기"
                >
                  <X className="h-5 w-5 text-slate-500" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {sortedExpenses.length === 0 ? (
                <div className="py-12 text-center text-slate-400">등록된 수입이 없습니다.</div>
              ) : mode === 'monthly' ? (
                <div className="overflow-hidden rounded-xl border border-slate-200">
                  <div className="divide-y divide-slate-100">{sortedExpenses.map(renderExpenseRow)}</div>
                </div>
              ) : (
                <div className="space-y-4">
                  {groupedExpenses.map((group) => (
                    <div key={group.yearMonth} className="overflow-hidden rounded-xl border border-slate-200">
                      <button
                        onClick={() =>
                          setExpandedMonth(expandedMonth === group.yearMonth ? null : group.yearMonth)
                        }
                        className="flex w-full items-center justify-between bg-slate-50 p-4 transition-colors hover:bg-slate-100"
                      >
                        <div className="flex items-center gap-2">
                          <ChevronRight
                            className={`h-4 w-4 text-slate-500 transition-transform ${
                              expandedMonth === group.yearMonth ? 'rotate-90' : ''
                            }`}
                          />
                          <span className="font-semibold text-slate-800">{group.label}</span>
                          <span className="text-sm text-slate-500">{group.expenses.length}건</span>
                        </div>
                        <span className="font-semibold text-slate-800">{group.total.toLocaleString()}원</span>
                      </button>

                      {expandedMonth === group.yearMonth && (
                        <div className="divide-y divide-slate-100">{group.expenses.map(renderExpenseRow)}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </Portal>

      {selectedExpense && (
        <ExpenseEditModal
          expense={selectedExpense}
          isOpen={!!selectedExpense}
          onClose={() => setSelectedExpense(null)}
          onSave={(updates) => {
            void handleSaveEdit(updates);
          }}
          onDelete={onDelete ? () => void handleDeleteExpense() : undefined}
          transactionType="income"
        />
      )}
    </>
  );
}
