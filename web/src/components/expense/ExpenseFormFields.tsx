import { AmountInput, CategorySelector } from '@/components/common';
import MonthlySplitAmountControl from '@/components/expense/MonthlySplitAmountControl';

interface MonthlySplitControlProps {
  enabled: boolean;
  showSplitInput: boolean;
  splitMonthsInput: string;
  splitMonthsError: boolean;
  onToggle: () => void;
  onSplitMonthsInputChange: (rawValue: string) => void;
}

interface ExpenseFormFieldsProps {
  merchant: string;
  onMerchantChange: (value: string) => void;
  amount: string;
  onAmountChange: (value: string) => void;
  category: string;
  onCategoryChange: (value: string) => void;
  memo: string;
  onMemoChange: (value: string) => void;
  monthlySplit: MonthlySplitControlProps;
  date?: string;
  onDateChange?: (value: string) => void;
  showDateField?: boolean;
  categoryLoading?: boolean;
  merchantLabel?: string;
  merchantPlaceholder?: string;
  memoLabel?: string;
  memoPlaceholder?: string;
  textInputPaddingClassName?: string;
  amountInputClassName?: string;
  showMerchantField?: boolean;
  showCategoryField?: boolean;
}

export default function ExpenseFormFields({
  merchant,
  onMerchantChange,
  amount,
  onAmountChange,
  category,
  onCategoryChange,
  memo,
  onMemoChange,
  monthlySplit,
  date,
  onDateChange,
  showDateField = false,
  categoryLoading,
  merchantLabel = '가맹점명',
  merchantPlaceholder,
  memoLabel = '메모 (선택)',
  memoPlaceholder,
  textInputPaddingClassName = 'px-3',
  amountInputClassName,
  showMerchantField = true,
  showCategoryField = true,
}: ExpenseFormFieldsProps) {
  const textInputClassName = `w-full ${textInputPaddingClassName} py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500`;
  const dateInputClassName = `w-full ${textInputPaddingClassName} py-2 pr-10 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 [&::-webkit-calendar-picker-indicator]:mr-1 [&::-webkit-calendar-picker-indicator]:cursor-pointer`;

  return (
    <div className="space-y-4">
      {showMerchantField && (
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">{merchantLabel}</label>
          <input
            type="text"
            value={merchant}
            onChange={(event) => onMerchantChange(event.target.value)}
            placeholder={merchantPlaceholder}
            className={textInputClassName}
          />
        </div>
      )}

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">금액</label>
        <MonthlySplitAmountControl
          enabled={monthlySplit.enabled}
          amountField={(
            <AmountInput
              value={amount}
              onChange={onAmountChange}
              className={amountInputClassName}
            />
          )}
          amountForPreview={amount ? Number.parseInt(amount, 10) : undefined}
          showSplitInput={monthlySplit.showSplitInput}
          splitMonthsInput={monthlySplit.splitMonthsInput}
          splitMonthsError={monthlySplit.splitMonthsError}
          onToggle={monthlySplit.onToggle}
          onSplitMonthsInputChange={monthlySplit.onSplitMonthsInputChange}
        />
      </div>

      {showCategoryField && (
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">카테고리</label>
          <CategorySelector
            value={category}
            onChange={onCategoryChange}
            isLoading={categoryLoading}
          />
        </div>
      )}

      {showDateField && date !== undefined && onDateChange && (
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">날짜</label>
          <input
            type="date"
            value={date}
            onChange={(event) => onDateChange(event.target.value)}
            className={dateInputClassName}
          />
        </div>
      )}

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">{memoLabel}</label>
        <input
          type="text"
          value={memo}
          onChange={(event) => onMemoChange(event.target.value)}
          placeholder={memoPlaceholder}
          className={textInputClassName}
        />
      </div>
    </div>
  );
}
