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
}: ExpenseFormFieldsProps) {
  const textInputClassName = `w-full ${textInputPaddingClassName} py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500`;

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          {merchantLabel}
        </label>
        <input
          type="text"
          value={merchant}
          onChange={(e) => onMerchantChange(e.target.value)}
          placeholder={merchantPlaceholder}
          className={textInputClassName}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          금액
        </label>
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

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          카테고리
        </label>
        <CategorySelector
          value={category}
          onChange={onCategoryChange}
          isLoading={categoryLoading}
        />
      </div>

      {showDateField && date !== undefined && onDateChange && (
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            날짜
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => onDateChange(e.target.value)}
            className={textInputClassName}
          />
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          {memoLabel}
        </label>
        <input
          type="text"
          value={memo}
          onChange={(e) => onMemoChange(e.target.value)}
          placeholder={memoPlaceholder}
          className={textInputClassName}
        />
      </div>
    </div>
  );
}

