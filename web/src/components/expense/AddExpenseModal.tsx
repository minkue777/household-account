'use client';

import { useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { AmountInput, ModalOverlay } from '@/components/common';
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
  const isIncome = transactionType === 'income';
  const defaultMerchant = isIncome ? '수입' : '';
  const defaultDate = selectedDate || getTodayLocalDate();

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

  const handleSubmit = () => {
    const parsedAmount = parsePositiveExpenseAmount(amount);
    if (parsedAmount === null) {
      return;
    }

    if (isIncome) {
      const item = memo.trim();
      if (!item) {
        return;
      }

      onAdd('수입', parsedAmount, 'etc', date, item);
      resetExpenseFormState({
        merchant: defaultMerchant,
        amount: '',
        category: 'etc',
        memo: '',
        date,
      });
      onClose();
      return;
    }

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

    onAdd(
      normalizedMerchant,
      parsedAmount,
      category,
      date,
      toOptionalMemo(memo),
      splitMonths
    );

    resetExpenseFormState({
      merchant: defaultMerchant,
      amount: '',
      category: resolveDefaultCategoryKey(activeCategories),
      memo: '',
      date,
    });
    resetMonthlySplitInput();
    onClose();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div className="m-4 w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="mb-6 text-xl font-bold text-slate-800">
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
            label: '추가',
            onClick: handleSubmit,
            variant: 'primary',
            disabled: isIncome
              ? parsePositiveExpenseAmount(amount) === null || memo.trim().length === 0
              : !isExpenseSubmitEnabled(merchant, amount),
          }}
        />
      </div>
    </ModalOverlay>
  );
}
