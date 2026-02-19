'use client';

import { useEffect, useState } from 'react';
import { Expense } from '@/types/expense';
import { useCategoryContext } from '@/contexts/CategoryContext';
import { ConfirmDialog, Portal } from '@/components/common';
import { openTossTransfer } from '@/lib/tossService';
import { checkSettleable } from '@/lib/settlementService';
import { PersonalAccountStorage, LocalPersonalAccount } from '@/lib/storage/personalAccountStorage';
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
  onSettlementRequest?: () => void;
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
  onSettlementRequest,
}: ExpenseEditModalProps) {
  const { getCategoryLabel } = useCategoryContext();

  const [personalAccount, setPersonalAccount] = useState<LocalPersonalAccount | null>(null);
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
    setPersonalAccount(PersonalAccountStorage.get());
  }, []);

  useEffect(() => {
    if (isOpen) {
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
    }
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

    if (category !== expense.category && rememberMerchant && onSaveMerchantRule) {
      onSaveMerchantRule(trimExpenseMerchant(merchant), category);
    }

    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      <Portal>
        <div
          className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-[9999] flex items-start justify-center pt-16 px-4 pb-4 overflow-y-auto"
          onClick={onClose}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-800">지출 수정</h3>
              <button
                onClick={onClose}
                className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex items-center justify-between text-sm text-slate-500 mb-4">
              <div>
                {expense.date} {expense.time && `· ${expense.time}`}
                {expense.cardLastFour && ` · ${expense.cardLastFour}`}
              </div>
              {(() => {
                const now = new Date();
                const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                const expenseYearMonth = expense.date.substring(0, 7);
                const isCurrentMonth = currentYearMonth === expenseYearMonth;

                const isSettleable = checkSettleable(expense.cardType, expense.category);
                if (!isSettleable) return null;

                if (expense.settled) {
                  let settledTime = '';
                  if (expense.settledAt) {
                    try {
                      const date = new Date(expense.settledAt);
                      settledTime = `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
                    } catch {
                      settledTime = '';
                    }
                  }
                  const details = [expense.settledBy, settledTime].filter(Boolean).join(' · ');
                  return (
                    <div className="text-right">
                      <div className="px-2.5 py-1 bg-slate-400 text-white text-xs rounded-lg inline-block">
                        정산완료
                      </div>
                      {details && (
                        <div className="text-[10px] text-slate-400 mt-0.5">({details})</div>
                      )}
                    </div>
                  );
                }

                if (!isCurrentMonth || !personalAccount) return null;

                return (
                  <button
                    onClick={() => {
                      onSettlementRequest?.();
                      openTossTransfer({
                        bankCode: personalAccount.bankCode,
                        accountNo: personalAccount.accountNo,
                        amount: expense.amount,
                        message: expense.merchant,
                      });
                    }}
                    className="px-2.5 py-1 bg-teal-500 text-white text-xs rounded-lg hover:bg-teal-600 transition-colors"
                  >
                    정산하기
                  </button>
                );
              })()}
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
              merchantLabel="가맹점"
              memoLabel="메모"
              memoPlaceholder="메모 입력 (선택)"
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

            {category !== expense.category && (
              <label className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg cursor-pointer mt-4">
                <input
                  type="checkbox"
                  checked={rememberMerchant}
                  onChange={(e) => setRememberMerchant(e.target.checked)}
                  className="w-4 h-4 text-blue-500 rounded focus:ring-blue-500"
                />
                <div>
                  <span className="text-sm font-medium text-slate-700">
                    이 가맹점 기억하기
                  </span>
                  <p className="text-xs text-slate-500">
                    다음에 &quot;{expense.merchant}&quot;에서 결제하면 자동으로 {getCategoryLabel(category)}(으)로 분류
                  </p>
                </div>
              </label>
            )}

            {expense.mergedFrom && expense.mergedFrom.length > 0 && onUnmerge && (
              <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-sm font-medium text-amber-800">
                    {expense.mergedFrom.length}개의 지출이 합쳐진 항목입니다
                  </span>
                </div>
                <div className="text-xs text-amber-700 mb-2 space-y-1">
                  {expense.mergedFrom.map((item, idx) => (
                    <div key={idx}>• {item.merchant} {item.amount.toLocaleString()}원</div>
                  ))}
                </div>
                <button
                  onClick={() => {
                    if (confirm('합치기를 되돌리면 원래 지출들이 복원됩니다. 진행하시겠습니까?')) {
                      onUnmerge();
                      onClose();
                    }
                  }}
                  className="w-full py-2 px-4 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                  </svg>
                  합치기 되돌리기
                </button>
              </div>
            )}

            {expense.splitGroupId && (onCancelSplitGroup || onUpdateSplitGroup) && (
              <div className="mt-4 p-3 bg-purple-50 border border-purple-200 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
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
                        onChange={(e) => setEditSplitMonths(Math.max(2, Number.parseInt(e.target.value, 10) || 2))}
                        className="w-20 px-3 py-1.5 border border-purple-300 rounded-lg text-center"
                      />
                      <span className="text-sm text-purple-700">개월로 변경</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowEditSplitGroup(false)}
                        className="flex-1 py-1.5 px-3 border border-purple-300 rounded-lg text-purple-600 text-sm hover:bg-purple-100"
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
                        className="flex-1 py-1.5 px-3 bg-purple-500 text-white rounded-lg text-sm hover:bg-purple-600"
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
                        className="flex-1 py-2 px-3 border border-purple-300 rounded-lg text-purple-600 text-sm hover:bg-purple-100"
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
                        className="flex-1 py-2 px-3 bg-amber-500 text-white rounded-lg text-sm hover:bg-amber-600"
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
                    className="flex-1 py-2.5 px-4 bg-slate-200 text-slate-800 rounded-xl hover:bg-slate-300 transition-colors font-medium flex items-center justify-center gap-1.5"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                    분리
                  </button>
                )}
                {onNotifyPartner && (
                  <button
                    onClick={() => {
                      onNotifyPartner();
                      onClose();
                    }}
                    className="flex-1 py-2.5 px-4 bg-slate-200 text-slate-800 rounded-xl hover:bg-slate-300 transition-colors font-medium flex items-center justify-center gap-1.5"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                    </svg>
                    파트너에게
                  </button>
                )}
              </div>

              <ExpenseActionButtons
                size="large"
                leftButton={onDelete ? {
                  label: '삭제',
                  onClick: () => setShowDeleteConfirm(true),
                  variant: 'neutral',
                  icon: (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  ),
                } : undefined}
                rightButton={showSplitInput && onSplitMonths ? {
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
                } : {
                  label: '저장',
                  onClick: handleSave,
                  variant: 'primary',
                  icon: (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ),
                }}
              />
            </div>
          </div>
        </div>
      </Portal>

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="지출 삭제"
        message="정말 삭제하시겠습니까?"
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

