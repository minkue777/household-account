'use client';

import { useState, useEffect } from 'react';
import { useCategoryContext } from '@/contexts/CategoryContext';
import { Portal } from '@/components/common';
import { CategorySelector, AmountInput } from '@/components/common';
import {
  sanitizeSplitMonthsInput,
  hasSplitMonthsError,
  parseValidSplitMonths,
  splitMonthsMinMessage,
} from '@/lib/utils/splitMonths';

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
  const [splitMonthsInput, setSplitMonthsInput] = useState('2');
  const [showSplitInput, setShowSplitInput] = useState(false);
  const [splitMonthsError, setSplitMonthsError] = useState(false);

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
      setSplitMonthsInput('2');
      setShowSplitInput(false);
      setSplitMonthsError(false);
    }
  }, [isOpen, selectedDate]);

  const handleSubmit = () => {
    const amountNum = parseInt(amount, 10);
    if (!merchant.trim() || amountNum <= 0) return;

    let splitMonths: number | undefined;
    if (showSplitInput) {
      const parsedMonths = parseValidSplitMonths(splitMonthsInput);
      if (parsedMonths === null) {
        setSplitMonthsError(true);
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
    setSplitMonthsInput('2');
    setShowSplitInput(false);
    setSplitMonthsError(false);
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
            <div className="flex gap-2">
              <div className="flex-1">
                <AmountInput
                  value={amount}
                  onChange={setAmount}
                  className="px-4"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!showSplitInput) setSplitMonthsInput('2');
                  setSplitMonthsError(false);
                  setShowSplitInput(!showSplitInput);
                }}
                className={`px-3 py-2 rounded-lg border transition-colors ${
                  showSplitInput
                    ? 'bg-purple-100 border-purple-300 text-purple-600'
                    : 'border-slate-300 text-slate-500 hover:bg-slate-50'
                }`}
                title="월별 분할"
              >
                ÷
              </button>
            </div>
            {showSplitInput && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  min="2"
                  max="24"
                  step="1"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={splitMonthsInput}
                  onChange={(e) => {
                    const value = sanitizeSplitMonthsInput(e.target.value);
                    setSplitMonthsInput(value);
                    setSplitMonthsError(hasSplitMonthsError(value));
                  }}
                  className={`w-20 px-3 py-1.5 border rounded-lg focus:outline-none focus:ring-2 text-center ${
                    splitMonthsError
                      ? 'border-red-400 focus:ring-red-400'
                      : 'border-slate-300 focus:ring-purple-500'
                  }`}
                />
                <span className="text-sm text-slate-600">개월 분할</span>
                {amount && (
                  <span className="text-sm text-purple-600 ml-auto">
                    월 {Math.floor(parseInt(amount, 10) / (parseInt(splitMonthsInput, 10) || 2)).toLocaleString()}원
                  </span>
                )}
              </div>
            )}
            {showSplitInput && splitMonthsError && (
              <p className="text-xs text-red-500 mt-1">{splitMonthsMinMessage}</p>
            )}
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
