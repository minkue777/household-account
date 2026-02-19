'use client';

import { useEffect } from 'react';
import { useCategoryContext } from '@/contexts/CategoryContext';
import { ModalOverlay } from '@/components/common';
import { useMonthlySplitInput } from '@/lib/utils/useMonthlySplitInput';
import { useExpenseFormState } from '@/lib/utils/useExpenseFormState';
import {
  isExpenseSubmitEnabled,
  parsePositiveExpenseAmount,
  resolveDefaultCategoryKey,
  toOptionalMemo,
  trimExpenseMerchant,
} from '@/lib/utils/expenseForm';
import ExpenseFormFields from '@/components/expense/ExpenseFormFields';
import ExpenseActionButtons from '@/components/expense/ExpenseActionButtons';

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
  ) => void;
  selectedDate?: string | null;
}

function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

export default function AddExpenseModal({
  isOpen,
  onClose,
  onAdd,
  selectedDate,
}: AddExpenseModalProps) {
  const { activeCategories, isLoading } = useCategoryContext();
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
      merchant: '',
      amount: '',
      category: 'etc',
      memo: '',
      date: selectedDate || getTodayDate(),
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
    if (activeCategories.length > 0 && !activeCategories.find((c) => c.key === category)) {
      setCategory(resolveDefaultCategoryKey(activeCategories, category));
    }
  }, [activeCategories, category, setCategory]);

  useEffect(() => {
    if (isOpen) {
      setDate(selectedDate || getTodayDate());
      resetMonthlySplitInput();
    }
  }, [isOpen, selectedDate, setDate, resetMonthlySplitInput]);

  const handleSubmit = () => {
    const normalizedMerchant = trimExpenseMerchant(merchant);
    const normalizedAmount = parsePositiveExpenseAmount(amount);

    if (!normalizedMerchant || normalizedAmount === null) {
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

    onAdd(
      normalizedMerchant,
      normalizedAmount,
      category,
      date,
      toOptionalMemo(memo),
      splitMonths
    );

    resetExpenseFormState({
      merchant: '',
      amount: '',
      category: resolveDefaultCategoryKey(activeCategories),
      memo: '',
      date,
    });
    resetMonthlySplitInput();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <ModalOverlay onClose={onClose}>
        <div className="bg-white rounded-2xl p-6 m-4 max-w-md w-full shadow-xl">
          <h2 className="text-xl font-bold text-slate-800 mb-6">지출 추가</h2>

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
            merchantPlaceholder="가맹점명 입력"
            memoLabel="메모 (선택)"
            memoPlaceholder="메모 입력"
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

          <ExpenseActionButtons
            className="mt-6 gap-3"
            leftButton={{
              label: '취소',
              onClick: onClose,
              variant: 'outline',
            }}
            rightButton={{
              label: '추가',
              onClick: handleSubmit,
              variant: 'primary',
              disabled: !isExpenseSubmitEnabled(merchant, amount),
            }}
          />
        </div>
    </ModalOverlay>
  );
}

