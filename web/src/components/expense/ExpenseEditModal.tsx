'use client';

import { useEffect, useState } from 'react';
import { Expense, TransactionType } from '@/types/expense';
import { useCategoryContext } from '@/contexts/CategoryContext';
import { ConfirmDialog, Portal } from '@/components/common';
import { useMonthlySplitInput } from '@/lib/utils/useMonthlySplitInput';
import { buildExpenseUpdates, trimExpenseMerchant } from '@/lib/utils/expenseForm';
import { useExpenseFormState } from '@/lib/utils/useExpenseFormState';
import ExpenseFormFields from '@/components/expense/ExpenseFormFields';
import ExpenseActionButtons from '@/components/expense/ExpenseActionButtons';

interface ExpenseEditModalProps {
  expense: Expense;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updates: { amount?: number; memo?: string; category?: string; merchant?: string }) => void;
  onSaveMerchantRule?: (merchantName: string, category: string) => void;
  onUnmerge?: () => void;
  onOpenSplit?: () => void;
  onSplitMonths?: (months: number) => void;
  onCancelSplitGroup?: () => void;
  onUpdateSplitGroup?: (newMonths: number) => void;
  onDelete?: () => void;
  onNotifyPartner?: () => void;
  transactionType: TransactionType;
}

export default function ExpenseEditModal({
  expense,
  isOpen,
  onClose,
  onSave,
  onSaveMerchantRule,
  onUnmerge,
  onOpenSplit,
  onSplitMonths,
  onCancelSplitGroup,
  onUpdateSplitGroup,
  onDelete,
  onNotifyPartner,
  transactionType,
}: ExpenseEditModalProps) {
  const { getCategoryLabel } = useCategoryContext();
  const transactionLabel = transactionType === 'income' ? '수입' : '지출';

  const {
    merchant,
    amount,
    category,
    memo,
    setMerchant,
    setAmount,
    setCategory,
    setMemo,
    resetExpenseFormState,
  } = useExpenseFormState({
    initial: {
      merchant: expense.merchant,
      amount: expense.amount.toString(),
      category: expense.category,
      memo: expense.memo || '',
      date: expense.date,
    },
  });
  const [rememberMerchant, setRememberMerchant] = useState(false);
  const {
    splitMonthsInput,
    showSplitInput,
    splitMonthsError,
    resetMonthlySplitInput,
    toggleSplitInput,
    handleSplitMonthsInputChange,
    getValidSplitMonths,
  } = useMonthlySplitInput();
  const [editSplitMonths, setEditSplitMonths] = useState(expense.splitTotal || 2);
  const [showEditSplitGroup, setShowEditSplitGroup] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    resetExpenseFormState({
      merchant: expense.merchant,
      amount: expense.amount.toString(),
      category: expense.category,
      memo: expense.memo || '',
      date: expense.date,
    });
    setRememberMerchant(false);
    resetMonthlySplitInput();
    setEditSplitMonths(expense.splitTotal || 2);
    setShowEditSplitGroup(false);
    setShowDeleteConfirm(false);
  }, [isOpen, expense, resetExpenseFormState, resetMonthlySplitInput]);

  const handleSave = () => {
    const updates = buildExpenseUpdates({
      original: {
        merchant: expense.merchant,
        amount: expense.amount,
        category: expense.category,
        memo: expense.memo,
      },
      draft: {
        merchant,
        amountInput: amount,
        category,
        memo,
      },
    });

    if (updates === null) {
      return;
    }

    if (Object.keys(updates).length > 0) {
      onSave(updates);
    }

    if (
      transactionType === 'expense' &&
      category !== expense.category &&
      rememberMerchant &&
      onSaveMerchantRule
    ) {
      onSaveMerchantRule(trimExpenseMerchant(merchant), category);
    }

    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      <Portal>
        <div
          className="fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto bg-slate-900/30 px-4 pb-4 pt-16 backdrop-blur-sm"
          onClick={onClose}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-800">{transactionLabel} 수정</h3>
              <button
                onClick={onClose}
                className="rounded-lg p-1 transition-colors hover:bg-slate-100"
              >
                <svg className="h-5 w-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="mb-4 text-sm text-slate-500">
              {expense.date}
              {expense.time ? ` · ${expense.time}` : ''}
              {expense.cardLastFour ? ` · ${expense.cardLastFour}` : ''}
            </div>

            <ExpenseFormFields
              merchant={merchant}
              onMerchantChange={setMerchant}
              amount={amount}
              onAmountChange={setAmount}
              category={category}
              onCategoryChange={setCategory}
              memo={memo}
              onMemoChange={setMemo}
              merchantLabel={transactionType === 'income' ? '수입처명' : '가맹점명'}
              memoLabel="메모"
              memoPlaceholder="메모를 입력하세요"
              textInputPaddingClassName="px-3"
              monthlySplit={{
                enabled: Boolean(onSplitMonths && !expense.splitGroupId),
                showSplitInput,
                splitMonthsInput,
                splitMonthsError,
                onToggle: toggleSplitInput,
                onSplitMonthsInputChange: handleSplitMonthsInputChange,
              }}
            />

            {transactionType === 'expense' && category !== expense.category && onSaveMerchantRule && (
              <label className="mt-4 flex cursor-pointer items-center gap-2 rounded-lg bg-blue-50 p-3">
                <input
                  type="checkbox"
                  checked={rememberMerchant}
                  onChange={(event) => setRememberMerchant(event.target.checked)}
                  className="h-4 w-4 rounded text-blue-500 focus:ring-blue-500"
                />
                <div>
                  <span className="text-sm font-medium text-slate-700">이 가맹점 기억하기</span>
                  <p className="text-xs text-slate-500">
                    다음에 &quot;{expense.merchant}&quot;에서 결제하면 자동으로 {getCategoryLabel(category)}로
                    분류합니다.
                  </p>
                </div>
              </label>
            )}

            {expense.mergedFrom && expense.mergedFrom.length > 0 && onUnmerge && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <svg className="h-4 w-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span className="text-sm font-medium text-amber-800">
                    {expense.mergedFrom.length}개의 항목이 합쳐져 있습니다
                  </span>
                </div>
                <div className="mb-2 space-y-1 text-xs text-amber-700">
                  {expense.mergedFrom.map((item, index) => (
                    <div key={index}>
                      · {item.merchant} {item.amount.toLocaleString()}원
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => {
                    if (confirm('합치기를 되돌리면 원래 항목들이 복원됩니다. 진행하시겠습니까?')) {
                      onUnmerge();
                      onClose();
                    }
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-white transition-colors hover:bg-amber-600"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
                    />
                  </svg>
                  합치기 되돌리기
                </button>
              </div>
            )}

            {expense.splitGroupId && (onCancelSplitGroup || onUpdateSplitGroup) && (
              <div className="mt-4 rounded-lg border border-purple-200 bg-purple-50 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <svg className="h-4 w-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                  <span className="text-sm font-medium text-purple-800">
                    월별 분할 ({expense.splitIndex}/{expense.splitTotal})
                  </span>
                </div>

                {showEditSplitGroup ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="2"
                        max="24"
                        value={editSplitMonths}
                        onChange={(event) =>
                          setEditSplitMonths(Math.max(2, Number.parseInt(event.target.value, 10) || 2))
                        }
                        className="w-20 rounded-lg border border-purple-300 px-3 py-1.5 text-center"
                      />
                      <span className="text-sm text-purple-700">개월로 변경</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowEditSplitGroup(false)}
                        className="flex-1 rounded-lg border border-purple-300 px-3 py-1.5 text-sm text-purple-600 hover:bg-purple-100"
                      >
                        취소
                      </button>
                      <button
                        onClick={() => {
                          if (onUpdateSplitGroup && confirm(`전체 분할을 ${editSplitMonths}개월로 변경하시겠습니까?`)) {
                            onUpdateSplitGroup(editSplitMonths);
                            onClose();
                          }
                        }}
                        className="flex-1 rounded-lg bg-purple-500 px-3 py-1.5 text-sm text-white hover:bg-purple-600"
                      >
                        변경
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    {onUpdateSplitGroup && (
                      <button
                        onClick={() => setShowEditSplitGroup(true)}
                        className="flex-1 rounded-lg border border-purple-300 px-3 py-2 text-sm text-purple-600 hover:bg-purple-100"
                      >
                        개월 수 변경
                      </button>
                    )}
                    {onCancelSplitGroup && (
                      <button
                        onClick={() => {
                          onCancelSplitGroup();
                          onClose();
                        }}
                        className="flex-1 rounded-lg bg-amber-500 px-3 py-2 text-sm text-white hover:bg-amber-600"
                      >
                        분할 취소
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 space-y-2">
              <div className="flex gap-2">
                {onOpenSplit && !expense.splitGroupId && (
                  <button
                    onClick={() => {
                      onClose();
                      onOpenSplit();
                    }}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-slate-200 px-4 py-2.5 font-medium text-slate-800 transition-colors hover:bg-slate-300"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                      />
                    </svg>
                    분리
                  </button>
                )}
                {onNotifyPartner && transactionType === 'expense' && (
                  <button
                    onClick={() => {
                      onNotifyPartner();
                      onClose();
                    }}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-slate-200 px-4 py-2.5 font-medium text-slate-800 transition-colors hover:bg-slate-300"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
                      />
                    </svg>
                    알림 보내기
                  </button>
                )}
              </div>

              <ExpenseActionButtons
                size="large"
                leftButton={
                  onDelete
                    ? {
                        label: '삭제',
                        onClick: () => setShowDeleteConfirm(true),
                        variant: 'neutral',
                        icon: (
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        ),
                      }
                    : undefined
                }
                rightButton={
                  showSplitInput && onSplitMonths
                    ? {
                        label: '분할 적용',
                        onClick: () => {
                          const months = getValidSplitMonths({ alertOnError: true });
                          if (months === null) {
                            return;
                          }
                          onSplitMonths(months);
                          onClose();
                        },
                        variant: 'accent',
                      }
                    : {
                        label: '저장',
                        onClick: handleSave,
                        variant: 'primary',
                        icon: (
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        ),
                      }
                }
              />
            </div>
          </div>
        </div>
      </Portal>

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title={`${transactionLabel} 삭제`}
        message={`정말 ${transactionLabel}을 삭제하시겠습니까?`}
        confirmLabel="삭제"
        cancelLabel="취소"
        variant="danger"
        onConfirm={() => {
          onDelete?.();
          onClose();
        }}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </>
  );
}
