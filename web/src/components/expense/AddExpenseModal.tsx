'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import AmountInput from '@/components/common/AmountInput';
import ModalOverlay from '@/components/common/ModalOverlay';
import { useCategoryContext } from '@/contexts/CategoryContext';
import { TransactionType } from '@/types/expense';
import { useMonthlySplitInput } from '@/lib/utils/useMonthlySplitInput';
import { useExpenseFormState } from '@/lib/utils/useExpenseFormState';
import {
  isExpenseSubmitEnabled,
  parsePositiveExpenseAmount,
  resolveDefaultCategoryKey,
  toOptionalMemo,
  trimExpenseMerchant,
} from '@/lib/utils/expenseForm';
import { getTodayLocalDate } from '@/lib/utils/date';
import ExpenseActionButtons from '@/components/expense/ExpenseActionButtons';
import ExpenseFormFields from '@/components/expense/ExpenseFormFields';
import { useAppDialog } from '@/contexts/AppDialogContext';

interface AddExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (
    merchant: string,
    amount: number,
    category: string,
    date: string,
    memo?: string,
    splitMonths?: number
  ) => Promise<void> | void;
  selectedDate?: string | null;
  transactionType: TransactionType;
}

export default function AddExpenseModal({
  isOpen,
  onClose,
  onAdd,
  selectedDate,
  transactionType,
}: AddExpenseModalProps) {
  const { activeCategories, isLoading } = useCategoryContext();
  const { showAlert } = useAppDialog();
  const isIncome = transactionType === 'income';
  const defaultMerchant = isIncome ? '수입' : '';
  const defaultDate = selectedDate || getTodayLocalDate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

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
      merchant: defaultMerchant,
      amount: '',
      category: 'etc',
      memo: '',
      date: defaultDate,
    },
  });

  const {
    splitMonthsInput,
    showSplitInput,
    splitMonthsError,
    resetMonthlySplitInput,
    toggleSplitInput,
    handleSplitMonthsInputChange,
    getValidSplitMonths,
  } = useMonthlySplitInput();

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    resetExpenseFormState({
      merchant: defaultMerchant,
      amount: '',
      category: resolveDefaultCategoryKey(activeCategories),
      memo: '',
      date: selectedDate || getTodayLocalDate(),
    });
    resetMonthlySplitInput();
  }, [
    activeCategories,
    defaultMerchant,
    isOpen,
    resetExpenseFormState,
    resetMonthlySplitInput,
    selectedDate,
  ]);

  const handleSubmit = async () => {
    if (isSubmittingRef.current) {
      return;
    }

    const parsedAmount = parsePositiveExpenseAmount(amount);
    if (parsedAmount === null) {
      return;
    }

    let submission: Parameters<AddExpenseModalProps['onAdd']>;
    let resetCategory: string;
    if (isIncome) {
      const item = memo.trim();
      if (!item) {
        return;
      }

      submission = ['수입', parsedAmount, 'etc', date, item];
      resetCategory = 'etc';
    } else {
      const normalizedMerchant = trimExpenseMerchant(merchant);
      if (!normalizedMerchant) {
        return;
      }

      let splitMonths: number | undefined;
      if (showSplitInput) {
        const parsedMonths = getValidSplitMonths();
        if (parsedMonths === null) {
          return;
        }
        splitMonths = parsedMonths;
      }

      submission = [
        normalizedMerchant,
        parsedAmount,
        category,
        date,
        toOptionalMemo(memo),
        splitMonths,
      ];
      resetCategory = resolveDefaultCategoryKey(activeCategories);
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      const pendingAdd = onAdd(...submission);

      resetExpenseFormState({
        merchant: defaultMerchant,
        amount: '',
        category: resetCategory,
        memo: '',
        date,
      });
      resetMonthlySplitInput();
      onClose();
      await pendingAdd;
    } catch (error) {
      console.error(`${transactionType === 'income' ? '수입' : '지출'} 추가 오류:`, error);
      await showAlert(
        `${transactionType === 'income' ? '수입' : '지출'}을 저장하지 못했습니다. `
          + '최신 내역을 확인한 뒤 다시 시도해 주세요.',
        `${transactionType === 'income' ? '수입' : '지출'} 추가 실패`
      );
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-expense-modal-title"
        className="m-4 w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
      >
        <h2
          id="add-expense-modal-title"
          className="mb-6 text-xl font-bold text-slate-800"
        >
          {isIncome ? '수입 추가' : '지출 추가'}
        </h2>

        {isIncome ? (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">항목</label>
              <input
                type="text"
                value={memo}
                onChange={(event) => setMemo(event.target.value)}
                placeholder="항목을 입력하세요"
                className="w-full rounded-lg border border-slate-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">금액</label>
              <AmountInput value={amount} onChange={setAmount} className="px-4" />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">날짜</label>
              <div className="relative">
                <input
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  className="w-full appearance-none rounded-lg border border-slate-300 px-4 py-2 pr-12 focus:outline-none focus:ring-2 focus:ring-blue-500 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:right-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-12 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0"
                />
                <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              </div>
            </div>
          </div>
        ) : (
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
            categoryLoading={isLoading}
            merchantLabel="가맹점명"
            merchantPlaceholder="가맹점명을 입력하세요"
            memoLabel="메모 (선택)"
            memoPlaceholder="메모를 입력하세요"
            textInputPaddingClassName="px-4"
            amountInputClassName="px-4"
            monthlySplit={{
              enabled: true,
              showSplitInput,
              splitMonthsInput,
              splitMonthsError,
              onToggle: toggleSplitInput,
              onSplitMonthsInputChange: handleSplitMonthsInputChange,
            }}
          />
        )}

        <ExpenseActionButtons
          className="mt-6 gap-3"
          leftButton={{
            label: '취소',
            onClick: onClose,
            variant: 'outline',
          }}
          rightButton={{
            label: isSubmitting ? '추가 중...' : '추가',
            onClick: () => void handleSubmit(),
            variant: 'primary',
            disabled: isSubmitting || (isIncome
              ? parsePositiveExpenseAmount(amount) === null || memo.trim().length === 0
              : !isExpenseSubmitEnabled(merchant, amount)),
          }}
        />
      </div>
    </ModalOverlay>
  );
}
