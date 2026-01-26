'use client';

import { useState, useEffect } from 'react';
import { Expense } from '@/types/expense';
import { useCategoryContext } from '@/contexts/CategoryContext';
import Portal from '../Portal';
import { CategorySelector, AmountInput } from '../common';

interface ExpenseEditModalProps {
  expense: Expense;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updates: { amount?: number; memo?: string; category?: string; merchant?: string }) => void;
  onSaveMerchantRule?: (merchantName: string, category: string) => void;
  onUnmerge?: () => void;
  onOpenSplit?: () => void;
  onSplitMonths?: (months: number) => void;
}

export default function ExpenseEditModal({
  expense,
  isOpen,
  onClose,
  onSave,
  onSaveMerchantRule,
  onUnmerge,
  onOpenSplit,
  onSplitMonths,
}: ExpenseEditModalProps) {
  const { getCategoryLabel } = useCategoryContext();

  const [editMerchant, setEditMerchant] = useState(expense.merchant);
  const [editAmount, setEditAmount] = useState(expense.amount.toString());
  const [editMemo, setEditMemo] = useState(expense.memo || '');
  const [editCategory, setEditCategory] = useState(expense.category);
  const [rememberMerchant, setRememberMerchant] = useState(false);
  const [splitMonths, setSplitMonths] = useState(1);
  const [showSplitInput, setShowSplitInput] = useState(false);

  // 모달이 열릴 때 상태 초기화
  useEffect(() => {
    if (isOpen) {
      setEditMerchant(expense.merchant);
      setEditAmount(expense.amount.toString());
      setEditMemo(expense.memo || '');
      setEditCategory(expense.category);
      setRememberMerchant(false);
      setSplitMonths(1);
      setShowSplitInput(false);
    }
  }, [isOpen, expense]);

  const handleSave = () => {
    const newAmount = parseInt(editAmount, 10);
    if (isNaN(newAmount) || newAmount <= 0) return;
    if (!editMerchant.trim()) return;

    const updates: { amount?: number; memo?: string; category?: string; merchant?: string } = {};

    if (editMerchant.trim() !== expense.merchant) {
      updates.merchant = editMerchant.trim();
    }
    if (newAmount !== expense.amount) {
      updates.amount = newAmount;
    }
    if (editMemo !== (expense.memo || '')) {
      updates.memo = editMemo;
    }
    if (editCategory !== expense.category) {
      updates.category = editCategory;
    }

    if (Object.keys(updates).length > 0) {
      onSave(updates);
    }

    // 카테고리가 변경되었고 기억하기 체크했으면 규칙 저장
    if (editCategory !== expense.category && rememberMerchant && onSaveMerchantRule) {
      onSaveMerchantRule(editMerchant.trim(), editCategory);
    }

    onClose();
  };

  if (!isOpen) return null;

  return (
    <Portal>
      <div
        className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-[9999] flex items-start justify-center pt-20 pb-4 px-4 overflow-y-auto"
        onClick={onClose}
      >
        <div
          className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="text-lg font-semibold text-slate-800 mb-4">
            지출 수정
          </h3>

          <div className="space-y-4">
            {/* 가맹점명 */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                가맹점
              </label>
              <input
                type="text"
                value={editMerchant}
                onChange={(e) => setEditMerchant(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    value={editAmount}
                    onChange={setEditAmount}
                  />
                </div>
                {onSplitMonths && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowSplitInput(!showSplitInput);
                      if (showSplitInput) setSplitMonths(1);
                    }}
                    className={`px-3 py-2 rounded-lg border transition-colors ${
                      showSplitInput
                        ? 'bg-purple-100 border-purple-300 text-purple-600'
                        : 'border-slate-300 text-slate-500 hover:bg-slate-50'
                    }`}
                    title="분할 인식"
                  >
                    ÷
                  </button>
                )}
              </div>
              {showSplitInput && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    min="2"
                    max="24"
                    value={splitMonths}
                    onChange={(e) => setSplitMonths(Math.max(2, parseInt(e.target.value, 10) || 2))}
                    className="w-20 px-3 py-1.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-center"
                  />
                  <span className="text-sm text-slate-600">개월 분할</span>
                  <span className="text-sm text-purple-600 ml-auto">
                    월 {Math.floor(expense.amount / splitMonths).toLocaleString()}원
                  </span>
                </div>
              )}
            </div>

            {/* 카테고리 */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                카테고리
              </label>
              <CategorySelector
                value={editCategory}
                onChange={setEditCategory}
              />
            </div>

            {/* 메모 */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                메모
              </label>
              <input
                type="text"
                value={editMemo}
                onChange={(e) => setEditMemo(e.target.value)}
                placeholder="메모 입력 (선택)"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* 가맹점 기억하기 (카테고리 변경시에만 표시) */}
            {editCategory !== expense.category && (
              <label className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  checked={rememberMerchant}
                  onChange={(e) => setRememberMerchant(e.target.checked)}
                  className="w-4 h-4 text-blue-500 rounded focus:ring-blue-500"
                />
                <div>
                  <span className="text-sm font-medium text-slate-700">
                    이 가맹점 기억하기
                  </span>
                  <p className="text-xs text-slate-500">
                    다음에 &quot;{expense.merchant}&quot;에서 결제하면 자동으로 {getCategoryLabel(editCategory)}(으)로 분류
                  </p>
                </div>
              </label>
            )}
          </div>

          {/* 합쳐진 지출 되돌리기 */}
          {expense.mergedFrom && expense.mergedFrom.length > 0 && onUnmerge && (
            <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm font-medium text-amber-800">
                  {expense.mergedFrom.length}개의 지출이 합쳐진 항목입니다
                </span>
              </div>
              <div className="text-xs text-amber-700 mb-2 space-y-1">
                {expense.mergedFrom.map((item, idx) => (
                  <div key={idx}>• {item.merchant} {item.amount.toLocaleString()}원</div>
                ))}
              </div>
              <button
                onClick={() => {
                  if (confirm('합치기를 되돌리면 원래 지출들이 복원됩니다. 진행하시겠습니까?')) {
                    onUnmerge();
                    onClose();
                  }
                }}
                className="w-full py-2 px-4 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                </svg>
                합치기 되돌리기
              </button>
            </div>
          )}

          {/* 나누기 버튼 */}
          {onOpenSplit && (
            <button
              onClick={() => {
                onClose();
                onOpenSplit();
              }}
              className="w-full py-2 px-4 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors flex items-center justify-center gap-2 mt-4"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
              지출 나누기
            </button>
          )}

          <div className="flex gap-3 mt-4">
            <button
              onClick={onClose}
              className="flex-1 py-2 px-4 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
            >
              취소
            </button>
            {showSplitInput && splitMonths > 1 && onSplitMonths ? (
              <button
                onClick={() => {
                  if (confirm(`이 지출을 ${splitMonths}개월로 분할하시겠습니까?\n기존 지출은 삭제되고 분할된 지출이 등록됩니다.`)) {
                    onSplitMonths(splitMonths);
                    onClose();
                  }
                }}
                className="flex-1 py-2 px-4 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors"
              >
                분할 적용
              </button>
            ) : (
              <button
                onClick={handleSave}
                className="flex-1 py-2 px-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                저장
              </button>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
