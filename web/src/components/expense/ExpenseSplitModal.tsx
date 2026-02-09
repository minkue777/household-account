'use client';

import { useState, useEffect } from 'react';
import { Expense } from '@/types/expense';
import { SplitItem } from '@/lib/expenseService';
import { Portal, CategorySelector } from '../common';

interface ExpenseSplitModalProps {
  expense: Expense;
  isOpen: boolean;
  onClose: () => void;
  onSave: (splits: SplitItem[]) => void;
}

export default function ExpenseSplitModal({
  expense,
  isOpen,
  onClose,
  onSave,
}: ExpenseSplitModalProps) {
  const [splits, setSplits] = useState<SplitItem[]>([]);
  const [splitAmountInputs, setSplitAmountInputs] = useState<Record<number, string>>({});

  // 모달이 열릴 때 상태 초기화
  useEffect(() => {
    if (isOpen) {
      setSplits([
        { merchant: expense.merchant, amount: Math.floor(expense.amount / 2), category: expense.category, memo: '' },
        { merchant: expense.merchant, amount: expense.amount - Math.floor(expense.amount / 2), category: expense.category, memo: '' },
      ]);
      setSplitAmountInputs({});
    }
  }, [isOpen, expense]);

  // 분할 항목 추가
  const handleAddSplit = () => {
    const totalUsed = splits.reduce((sum, s) => sum + s.amount, 0);
    const remaining = Math.max(0, expense.amount - totalUsed);
    setSplits([...splits, { merchant: expense.merchant, amount: remaining, category: expense.category, memo: '' }]);
  };

  // 분할 항목 삭제
  const handleRemoveSplit = (index: number) => {
    if (splits.length <= 2) return;
    setSplits(splits.filter((_, i) => i !== index));
  };

  // 분할 항목 수정
  const handleUpdateSplit = (index: number, field: keyof SplitItem, value: string | number) => {
    const newSplits = [...splits];
    if (field === 'amount') {
      const newAmount = Number(value) || 0;
      newSplits[index] = { ...newSplits[index], amount: newAmount };

      // 2개 항목일 때 다른 항목 자동 조정
      if (newSplits.length === 2) {
        const otherIndex = index === 0 ? 1 : 0;
        const otherAmount = Math.max(0, expense.amount - newAmount);
        newSplits[otherIndex] = { ...newSplits[otherIndex], amount: otherAmount };
      }
    } else {
      newSplits[index] = { ...newSplits[index], [field]: value };
    }
    setSplits(newSplits);
  };

  // 금액 입력 핸들러 (0 처리)
  const handleAmountInputChange = (index: number, value: string) => {
    if (value === '') {
      setSplitAmountInputs({ ...splitAmountInputs, [index]: '' });
      handleUpdateSplit(index, 'amount', 0);
      return;
    }
    const numericValue = value.replace(/[^0-9]/g, '').replace(/^0+/, '') || '0';
    setSplitAmountInputs({ ...splitAmountInputs, [index]: numericValue });
    handleUpdateSplit(index, 'amount', numericValue);
  };

  const getAmountInputValue = (index: number, amount: number) => {
    if (splitAmountInputs[index] !== undefined) {
      return splitAmountInputs[index];
    }
    return amount.toString();
  };

  // 분할 저장
  const handleSaveSplit = () => {
    const totalSplit = splits.reduce((sum, s) => sum + s.amount, 0);
    if (totalSplit !== expense.amount) {
      alert(`분할 금액의 합(${totalSplit.toLocaleString()}원)이 원래 금액(${expense.amount.toLocaleString()}원)과 일치하지 않습니다.`);
      return;
    }
    if (splits.some((s) => s.amount <= 0)) {
      alert('모든 분할 항목의 금액은 0보다 커야 합니다.');
      return;
    }
    onSave(splits);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Portal>
      <div
        className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm flex items-start justify-center z-[9999] pt-20 pb-4 px-4 overflow-y-auto"
        onClick={onClose}
      >
        <div
          className="bg-white rounded-2xl p-6 max-w-lg w-full shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="text-lg font-semibold text-slate-800 mb-2">
            지출 내역 분리
          </h3>
          <p className="text-sm text-slate-500 mb-4">
            {expense.merchant} {expense.amount.toLocaleString()}원을 여러 항목으로 나눕니다
          </p>

          {/* 분할 합계 표시 */}
          <div className="mb-4 p-3 bg-slate-100 rounded-lg">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">분할 합계</span>
              <span className={`font-medium ${
                splits.reduce((sum, s) => sum + s.amount, 0) === expense.amount
                  ? 'text-green-600'
                  : 'text-red-500'
              }`}>
                {splits.reduce((sum, s) => sum + s.amount, 0).toLocaleString()}원 / {expense.amount.toLocaleString()}원
              </span>
            </div>
          </div>

          {/* 분할 항목들 */}
          <div className="space-y-4 mb-4">
            {splits.map((split, index) => (
              <div key={index} className="p-4 border border-slate-200 rounded-xl">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-slate-700">항목 {index + 1}</span>
                  {splits.length > 2 && (
                    <button
                      onClick={() => handleRemoveSplit(index)}
                      className="text-slate-400 hover:text-red-500"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* 가맹점명 */}
                <div className="mb-3">
                  <label className="block text-xs text-slate-500 mb-1">가맹점명</label>
                  <input
                    type="text"
                    value={split.merchant}
                    onChange={(e) => handleUpdateSplit(index, 'merchant', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                </div>

                {/* 금액 */}
                <div className="mb-3">
                  <label className="block text-xs text-slate-500 mb-1">금액</label>
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={getAmountInputValue(index, split.amount)}
                      onChange={(e) => handleAmountInputChange(index, e.target.value)}
                      onFocus={() => {
                        if (split.amount === 0) {
                          setSplitAmountInputs({ ...splitAmountInputs, [index]: '' });
                        }
                      }}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm pr-10"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">원</span>
                  </div>
                </div>

                {/* 카테고리 */}
                <div className="mb-3">
                  <label className="block text-xs text-slate-500 mb-1">카테고리</label>
                  <CategorySelector
                    value={split.category}
                    onChange={(category) => handleUpdateSplit(index, 'category', category)}
                    size="sm"
                  />
                </div>

                {/* 메모 */}
                <div>
                  <label className="block text-xs text-slate-500 mb-1">메모 (선택)</label>
                  <input
                    type="text"
                    value={split.memo || ''}
                    onChange={(e) => handleUpdateSplit(index, 'memo', e.target.value)}
                    placeholder="메모 입력"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                </div>
              </div>
            ))}
          </div>

          {/* 항목 추가 버튼 */}
          <button
            onClick={handleAddSplit}
            className="w-full py-2 px-4 border border-dashed border-slate-300 rounded-lg text-slate-500 hover:bg-slate-50 transition-colors flex items-center justify-center gap-2 mb-4"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            항목 추가
          </button>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-2 px-4 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleSaveSplit}
              className="flex-1 py-2 px-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
            >
              나누기
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
