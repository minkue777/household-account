import { ReactNode } from 'react';
import { splitMonthsMinMessage } from '@/lib/utils/splitMonths';

interface MonthlySplitAmountControlProps {
  enabled: boolean;
  amountField: ReactNode;
  amountForPreview?: number;
  showSplitInput: boolean;
  splitMonthsInput: string;
  splitMonthsError: boolean;
  onToggle: () => void;
  onSplitMonthsInputChange: (rawValue: string) => void;
}

export default function MonthlySplitAmountControl({
  enabled,
  amountField,
  amountForPreview,
  showSplitInput,
  splitMonthsInput,
  splitMonthsError,
  onToggle,
  onSplitMonthsInputChange,
}: MonthlySplitAmountControlProps) {
  const hasPreviewAmount = typeof amountForPreview === 'number' && Number.isFinite(amountForPreview);
  const monthsForPreview = Number.parseInt(splitMonthsInput, 10) || 2;

  return (
    <div>
      <div className="flex gap-2">
        <div className="flex-1">{amountField}</div>
        {enabled && (
          <button
            type="button"
            onClick={onToggle}
            className={`px-3 py-2 rounded-lg border transition-colors ${
              showSplitInput
                ? 'bg-purple-100 border-purple-300 text-purple-600'
                : 'border-slate-300 text-slate-500 hover:bg-slate-50'
            }`}
            title="월별 분할"
          >
            ÷
          </button>
        )}
      </div>

      {enabled && showSplitInput && (
        <div className="mt-2">
          <div className={`flex items-center gap-2 ${splitMonthsError ? 'animate-shake' : ''}`}>
            <input
              type="number"
              min="2"
              max="24"
              step="1"
              inputMode="numeric"
              pattern="[0-9]*"
              value={splitMonthsInput}
              onChange={(e) => onSplitMonthsInputChange(e.target.value)}
              className={`w-20 px-3 py-1.5 border rounded-lg focus:outline-none focus:ring-2 text-center ${
                splitMonthsError
                  ? 'border-red-400 focus:ring-red-400'
                  : 'border-slate-300 focus:ring-purple-500'
              }`}
            />
            <span className="text-sm text-slate-600">개월 분할</span>
            {hasPreviewAmount && (
              <span className="text-sm text-purple-600 ml-auto">
                월 {Math.floor((amountForPreview as number) / monthsForPreview).toLocaleString()}원
              </span>
            )}
          </div>

          {splitMonthsError && (
            <p className="text-xs text-red-500 mt-1">{splitMonthsMinMessage}</p>
          )}
        </div>
      )}
    </div>
  );
}
