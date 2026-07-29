'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Check, ChevronDown, Info, Share2, Split, Trash2, Undo2, X } from 'lucide-react';
import AmountInput from '@/components/common/AmountInput';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import Portal from '@/components/common/Portal';
import { useCategoryContext } from '@/contexts/CategoryContext';
import { Expense, TransactionType } from '@/types/expense';
import { useMonthlySplitInput } from '@/lib/utils/useMonthlySplitInput';
import {
  buildExpenseUpdates,
  parsePositiveExpenseAmount,
  trimExpenseMerchant,
  ExpenseUpdates,
} from '@/lib/utils/expenseForm';
import { useExpenseFormState } from '@/lib/utils/useExpenseFormState';
import ExpenseFormFields from '@/components/expense/ExpenseFormFields';
import ExpenseActionButtons from '@/components/expense/ExpenseActionButtons';
import { useAppDialog } from '@/contexts/AppDialogContext';

interface ExpenseEditModalProps {
  expense: Expense;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updates: ExpenseUpdates) => Promise<void> | void;
  onSaveMerchantRule?: (
    merchantName: string,
    category: string
  ) => Promise<void> | void;
  onUnmerge?: () => void;
  onOpenSplit?: () => void;
  onSplitMonths?: (months: number) => void;
  onCancelSplitGroup?: () => Promise<void> | void;
  onUpdateSplitGroup?: (newMonths: number) => void;
  onDelete?: () => Promise<void> | void;
  onNotifyPartner?: () => Promise<void> | void;
  transactionType: TransactionType;
}

type ExpenseActionConfirmType = 'unmerge' | 'updateSplitGroup';

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
  const { showAlert } = useAppDialog();
  const isIncome = transactionType === 'income';
  const transactionLabel = isIncome ? '수입' : '지출';

  const {
    merchant,
    amount,
    category,
    memo,
    date,
    setMerchant,
    setAmount,
    setCategory,
    setMemo,
    setDate,
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
  const [pendingActionConfirm, setPendingActionConfirm] = useState<ExpenseActionConfirmType | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const mergedItemCount = expense.mergeLeafIds?.length
    ?? expense.mergedFrom?.length
    ?? 0;

  const displayCardLabel = (() => {
    if (!expense.cardLastFour) {
      return '';
    }

    const localCurrencyMatch = expense.cardLastFour.match(/^(경기지역화폐|대전사랑카드|세종지역화폐|여민전)\((.+)\)$/);
    if (localCurrencyMatch) {
      return localCurrencyMatch[1] === '세종지역화폐' || localCurrencyMatch[1] === '여민전'
        ? `세종지역화폐(${localCurrencyMatch[2]})`
        : `지역(${localCurrencyMatch[2]})`;
    }

    if (expense.cardLastFour === '경기지역화폐' || expense.cardLastFour === '대전사랑카드') {
      return '지역';
    }

    if (expense.cardLastFour === '세종지역화폐' || expense.cardLastFour === '여민전') {
      return '세종지역화폐';
    }

    if (expense.cardLastFour === '온누리상품권') {
      return '온누리';
    }

    return expense.cardLastFour;
  })();

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
    setPendingActionConfirm(null);
  }, [expense, isOpen, resetExpenseFormState, resetMonthlySplitInput]);

  const handleSave = async () => {
    if (isSubmittingRef.current) {
      return;
    }

    let updates: ExpenseUpdates;
    let merchantRule:
      | { merchantName: string; category: string }
      | undefined;

    if (isIncome) {
      const item = memo.trim();
      const parsedAmount = parsePositiveExpenseAmount(amount);
      if (!item || parsedAmount === null) {
        return;
      }

      updates = {};
      if (parsedAmount !== expense.amount) {
        updates.amount = parsedAmount;
      }
      if (item !== (expense.memo || '')) {
        updates.memo = item;
      }
      if (date !== expense.date) {
        updates.date = date;
      }
    } else {
      const expenseUpdates = buildExpenseUpdates({
        original: {
          merchant: expense.merchant,
          amount: expense.amount,
          category: expense.category,
          memo: expense.memo,
          date: expense.date,
        },
        draft: {
          merchant,
          amountInput: amount,
          category,
          memo,
          date,
        },
      });

      if (expenseUpdates === null) {
        return;
      }
      updates = expenseUpdates;

      if (
        category !== expense.category &&
        rememberMerchant &&
        onSaveMerchantRule
      ) {
        merchantRule = {
          merchantName: trimExpenseMerchant(merchant),
          category,
        };
      }
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    let saveStage: 'transaction' | 'merchant-rule' = 'transaction';
    try {
      const pendingSave = Object.keys(updates).length > 0
        ? onSave(updates)
        : undefined;
      onClose();
      await pendingSave;

      if (merchantRule && onSaveMerchantRule) {
        saveStage = 'merchant-rule';
        await onSaveMerchantRule(
          merchantRule.merchantName,
          merchantRule.category
        );
      }
    } catch (error) {
      const detail = error instanceof Error && error.message.trim() !== ''
        ? `\n\n${error.message}`
        : '';
      if (saveStage === 'merchant-rule') {
        await showAlert(
          `${transactionLabel} 수정은 저장됐지만 가맹점 분류 규칙을 저장하지 못했습니다. 설정에서 규칙을 다시 등록해 주세요.${detail}`,
          '가맹점 규칙 저장 실패'
        );
      } else {
        await showAlert(
          `${transactionLabel} 수정을 저장하지 못했습니다. 최신 내역을 확인한 뒤 다시 시도해 주세요.${detail}`,
          `${transactionLabel} 수정 실패`
        );
      }
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete || isSubmittingRef.current) {
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setShowDeleteConfirm(false);
    try {
      const pendingDelete = onDelete();
      onClose();
      await pendingDelete;
    } catch (error) {
      const detail = error instanceof Error && error.message.trim() !== ''
        ? `\n\n${error.message}`
        : '';
      await showAlert(
        `${transactionLabel}을 삭제하지 못했습니다. 최신 내역을 확인한 뒤 다시 시도해 주세요.${detail}`,
        `${transactionLabel} 삭제 실패`
      );
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleNotifyPartner = async () => {
    if (!onNotifyPartner || isSubmittingRef.current) {
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      const pendingNotification = onNotifyPartner();
      onClose();
      await pendingNotification;
    } catch (error) {
      const detail = error instanceof Error && error.message.trim() !== ''
        ? `\n\n${error.message}`
        : '';
      await showAlert(
        `다른 가구원에게 알림을 보내지 못했습니다. 다시 시도해 주세요.${detail}`,
        '알림 전송 실패'
      );
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleCancelSplitGroup = () => {
    if (!onCancelSplitGroup || isSubmittingRef.current) {
      return;
    }

    isSubmittingRef.current = true;
    // 네트워크 명령보다 모달 종료를 먼저 확정합니다. 원장 목록은 서버의
    // 원자적 Firestore snapshot이 기존 분할 항목을 원본으로 한 번에 교체합니다.
    onClose();
    void (async () => {
      try {
        await onCancelSplitGroup();
      } finally {
        isSubmittingRef.current = false;
      }
    })();
  };

  const handleActionConfirm = () => {
    if (pendingActionConfirm === 'unmerge' && onUnmerge) {
      setPendingActionConfirm(null);
      onUnmerge();
      onClose();
      return;
    }

    if (pendingActionConfirm === 'updateSplitGroup' && onUpdateSplitGroup) {
      setPendingActionConfirm(null);
      onUpdateSplitGroup(editSplitMonths);
      onClose();
    }
  };

  if (!isOpen) {
    return null;
  }

  const actionConfirmTitle =
    pendingActionConfirm === 'unmerge'
      ? '합치기 되돌리기'
      : '분할 개월 수 변경';
  const actionConfirmMessage =
    pendingActionConfirm === 'unmerge'
      ? '합치기를 되돌리면 원래 항목들이 복원됩니다. 진행하시겠습니까?'
      : `전체 분할을 ${editSplitMonths}개월로 변경하시겠습니까?`;
  const actionConfirmLabel =
    pendingActionConfirm === 'updateSplitGroup' ? '변경' : '진행';

  const renderIncomeFields = () => (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">항목</label>
        <input
          type="text"
          value={memo}
          onChange={(event) => setMemo(event.target.value)}
          placeholder="항목을 입력하세요"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">금액</label>
        <AmountInput value={amount} onChange={setAmount} />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">날짜</label>
        <div className="relative">
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="w-full appearance-none rounded-lg border border-slate-300 px-3 py-2 pr-12 focus:outline-none focus:ring-2 focus:ring-blue-500 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:right-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-12 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0"
          />
          <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        </div>
      </div>
    </div>
  );

  const renderExpenseInfo = () => (
    <div className="mb-4 text-sm text-slate-500">
      {expense.date}
      {expense.time ? ` · ${expense.time}` : ''}
      {displayCardLabel ? ` · ${displayCardLabel}` : ''}
    </div>
  );

  const renderExpenseExtraSections = () => (
    <>
      {category !== expense.category && onSaveMerchantRule && (
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

      {mergedItemCount > 0 && onUnmerge && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="mb-2 flex items-center gap-2">
            <Info className="h-4 w-4 text-amber-600" />
            <span className="text-sm font-medium text-amber-800">
              {mergedItemCount}개의 항목이 합쳐져 있습니다
            </span>
          </div>
          {expense.mergedFrom && expense.mergedFrom.length > 0 ? (
            <div className="mb-2 space-y-1 text-xs text-amber-700">
              {expense.mergedFrom.map((item, index) => (
                <div key={index}>· {item.merchant} {item.amount.toLocaleString()}원</div>
              ))}
            </div>
          ) : (
            <p className="mb-2 text-xs text-amber-700">
              원본 항목은 서버에 안전하게 보존되어 있습니다.
            </p>
          )}
          <button
            onClick={() => setPendingActionConfirm('unmerge')}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-white transition-colors hover:bg-amber-600"
          >
            <Undo2 className="h-4 w-4" />
            합치기 되돌리기
          </button>
        </div>
      )}

      {expense.splitGroupId && (onCancelSplitGroup || onUpdateSplitGroup) && (
        <div className="mt-4 rounded-lg border border-purple-200 bg-purple-50 p-3">
          <div className="mb-2 flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-purple-600" />
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
                    if (onUpdateSplitGroup) {
                      setPendingActionConfirm('updateSplitGroup');
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
                  onClick={handleCancelSplitGroup}
                  className="flex-1 rounded-lg bg-amber-500 px-3 py-2 text-sm text-white hover:bg-amber-600"
                >
                  분할 취소
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );

  const renderExpenseActionRow = () => (
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
            <Split className="h-4 w-4" />
            분리
          </button>
        )}
        {onNotifyPartner && (
          <button
            onClick={() => void handleNotifyPartner()}
            disabled={isSubmitting}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-slate-200 px-4 py-2.5 font-medium text-slate-800 transition-colors hover:bg-slate-300"
          >
            <Share2 className="h-4 w-4" />
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
                disabled: isSubmitting,
                icon: (
                  <Trash2 className="h-4 w-4" />
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
                label: isSubmitting ? '저장 중...' : '저장',
                onClick: () => void handleSave(),
                variant: 'primary',
                disabled: isSubmitting,
                icon: (
                  <Check className="h-4 w-4" />
                ),
              }
        }
      />
    </div>
  );

  return (
    <>
      <Portal>
        <div
          className="fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto bg-slate-900/30 px-4 pb-4 pt-16 backdrop-blur-sm"
          onClick={onClose}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${transactionLabel} 수정`}
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-800">{transactionLabel} 수정</h3>
              <button
                onClick={onClose}
                className="rounded-lg p-1 transition-colors hover:bg-slate-100"
                aria-label="닫기"
              >
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>

            {isIncome ? (
              renderIncomeFields()
            ) : (
              <>
                {renderExpenseInfo()}
                <ExpenseFormFields
                  merchant={merchant}
                  onMerchantChange={setMerchant}
                  amount={amount}
                  onAmountChange={setAmount}
                  category={category}
                  onCategoryChange={setCategory}
                  memo={memo}
                  onMemoChange={setMemo}
                  date={date}
                  onDateChange={setDate}
                  showDateField
                  merchantLabel="가맹점명"
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
                {renderExpenseExtraSections()}
              </>
            )}

            {isIncome ? (
              <ExpenseActionButtons
                className="mt-6"
                size="large"
                leftButton={
                  onDelete
                    ? {
                        label: '삭제',
                        onClick: () => setShowDeleteConfirm(true),
                        variant: 'neutral',
                        disabled: isSubmitting,
                      }
                    : undefined
                }
                rightButton={{
                  label: isSubmitting ? '저장 중...' : '저장',
                  onClick: () => void handleSave(),
                  variant: 'primary',
                  disabled: isSubmitting,
                }}
              />
            ) : (
              renderExpenseActionRow()
            )}
          </div>
        </div>
      </Portal>

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title={`${transactionLabel} 삭제`}
        message={`정말 ${transactionLabel} 항목을 삭제하시겠습니까?`}
        confirmLabel="삭제"
        cancelLabel="취소"
        variant="danger"
        onConfirm={() => void handleDelete()}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      <ConfirmDialog
        isOpen={pendingActionConfirm !== null}
        title={actionConfirmTitle}
        message={actionConfirmMessage}
        confirmLabel={actionConfirmLabel}
        cancelLabel="취소"
        onConfirm={handleActionConfirm}
        onCancel={() => setPendingActionConfirm(null)}
      />
    </>
  );
}
