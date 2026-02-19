'use client';

import { useState, useEffect } from 'react';
import { useCategoryContext } from '@/contexts/CategoryContext';
import { Portal } from '@/components/common';
import { CategorySelector, AmountInput } from '@/components/common';
import { useMonthlySplitInput } from '@/lib/utils/useMonthlySplitInput';
import MonthlySplitAmountControl from '@/components/expense/MonthlySplitAmountControl';

interface AddExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (merchant: string, amount: number, category: string, date: string, memo?: string, splitMonths?: number) => void;
  selectedDate?: string | null;
}

export default function AddExpenseModal({
  isOpen,
  onClose,
  onAdd,
  selectedDate,
}: AddExpenseModalProps) {
  const { activeCategories, isLoading } = useCategoryContext();

  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<string>('etc');
  const [date, setDate] = useState(selectedDate || new Date().toISOString().split('T')[0]);
  const [memo, setMemo] = useState('');
  const {
    splitMonthsInput,
    showSplitInput,
    splitMonthsError,
    resetMonthlySplitInput,
    toggleSplitInput,
    handleSplitMonthsInputChange,
    getValidSplitMonths,
  } = useMonthlySplitInput();

  // 활성 카테고리가 로드되면 첫 번째 카테고리를 기본값으로 설정
  useEffect(() => {
    if (activeCategories.length > 0 && !activeCategories.find(c => c.key === category)) {
      setCategory(activeCategories[0].key);
    }
  }, [activeCategories, category]);

  // 모달이 열릴 때 선택된 날짜로 초기화
  useEffect(() => {
    if (isOpen) {
      setDate(selectedDate || new Date().toISOString().split('T')[0]);
      resetMonthlySplitInput();
    }
  }, [isOpen, selectedDate, resetMonthlySplitInput]);

  const handleSubmit = () => {
    const amountNum = parseInt(amount, 10);
    if (!merchant.trim() || amountNum <= 0) return;

    let splitMonths: number | undefined;
    if (showSplitInput) {
      const parsedMonths = getValidSplitMonths();
      if (parsedMonths === null) {
        return;
      }
      splitMonths = parsedMonths;
    }

    onAdd(merchant.trim(), amountNum, category, date, memo.trim() || undefined, splitMonths);

    // 폼 초기화
    setMerchant('');
    setAmount('');
    setCategory(activeCategories[0]?.key || 'etc');
    setMemo('');
    resetMonthlySplitInput();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Portal>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]">
        <div className="bg-white rounded-2xl p-6 m-4 max-w-md w-full shadow-xl">
        <h2 className="text-xl font-bold text-slate-800 mb-6">지출 추가</h2>

        <div className="space-y-4">
          {/* 가맹점명 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              가맹점명
            </label>
            <input
              type="text"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              placeholder="가맹점명 입력"
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* 금액 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              금액
            </label>
            <MonthlySplitAmountControl
              enabled
              amountField={(
                <AmountInput
                  value={amount}
                  onChange={setAmount}
                  className="px-4"
                />
              )}
              amountForPreview={amount ? Number.parseInt(amount, 10) : undefined}
              showSplitInput={showSplitInput}
              splitMonthsInput={splitMonthsInput}
              splitMonthsError={splitMonthsError}
              onToggle={toggleSplitInput}
              onSplitMonthsInputChange={handleSplitMonthsInputChange}
            />
          </div>

          {/* 카테고리 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              카테고리
            </label>
            <CategorySelector
              value={category}
              onChange={setCategory}
              isLoading={isLoading}
            />
          </div>

          {/* 날짜 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              날짜
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* 메모 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              메모 (선택)
            </label>
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="메모 입력"
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* 버튼 */}
        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 py-2 px-4 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={!merchant.trim() || !amount}
            className="flex-1 py-2 px-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            추가
          </button>
        </div>
        </div>
      </div>
    </Portal>
  );
}
