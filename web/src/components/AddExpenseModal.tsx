'use client';

import { useState, useEffect } from 'react';
import { useCategoryContext } from '@/contexts/CategoryContext';
import Portal from './Portal';

interface AddExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (merchant: string, amount: number, category: string, date: string, memo?: string) => void;
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
      onAdd(merchant.trim(), amountNum, category, date, memo.trim() || undefined);
      // 폼 초기화
      setMerchant('');
      setAmount('');
      setCategory(activeCategories[0]?.key || 'etc');
      setMemo('');
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
            <div className="relative">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 pr-10"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500">
                원
              </span>
            </div>
          </div>

          {/* 카테고리 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              카테고리
            </label>
            {isLoading ? (
              <div className="grid grid-cols-5 gap-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-16 bg-slate-100 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-5 gap-2">
                {activeCategories.map((cat) => (
                  <button
                    key={cat.key}
                    onClick={() => setCategory(cat.key)}
                    className={`flex flex-col items-center p-2 rounded-lg border-2 transition-colors ${
                      category === cat.key
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div
                      className="w-6 h-6 rounded-full mb-1"
                      style={{ backgroundColor: cat.color }}
                    />
                    <span className="text-xs text-slate-700">
                      {cat.label.slice(0, 2)}
                    </span>
                  </button>
                ))}
              </div>
            )}
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
