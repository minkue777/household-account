'use client';

import { useState, useEffect } from 'react';
import { useCategoryContext } from '@/contexts/CategoryContext';
import Portal from './Portal';
import { CategorySelector, AmountInput } from './common';

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
  const [splitMonths, setSplitMonths] = useState(1); // 1이면 분할 안 함

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
    }
  }, [isOpen, selectedDate]);

  const handleSubmit = () => {
    const amountNum = parseInt(amount, 10);
    if (merchant.trim() && amountNum > 0) {
      onAdd(merchant.trim(), amountNum, category, date, memo.trim() || undefined, splitMonths > 1 ? splitMonths : undefined);
      // 폼 초기화
      setMerchant('');
      setAmount('');
      setCategory(activeCategories[0]?.key || 'etc');
      setMemo('');
      setSplitMonths(1);
      onClose();
    }
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
            <AmountInput
              value={amount}
              onChange={setAmount}
              className="px-4"
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

          {/* 분할 인식 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              분할 인식 (선택)
            </label>
            <div className="relative">
              <input
                type="number"
                min="1"
                max="24"
                value={splitMonths}
                onChange={(e) => setSplitMonths(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 pr-12"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">개월</span>
            </div>
            {splitMonths > 1 && amount && (
              <p className="mt-2 text-sm text-purple-600">
                → 매월 {Math.floor(parseInt(amount, 10) / splitMonths).toLocaleString()}원씩 {splitMonths}개월
              </p>
            )}
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
