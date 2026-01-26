'use client';

import { useState, useEffect } from 'react';
import { Expense } from '@/types/expense';
import { CategorySelector, AmountInput } from '../common';

interface SearchExpenseEditProps {
  expense: Expense;
  onClose: () => void;
  onSave: (updates: { amount?: number; memo?: string; category?: string; merchant?: string }) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}

export default function SearchExpenseEdit({
  expense,
  onClose,
  onSave,
  onDelete,
}: SearchExpenseEditProps) {
  const [editMerchant, setEditMerchant] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editMemo, setEditMemo] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // 선택된 지출이 변경되면 편집 폼 초기화
  useEffect(() => {
    setEditMerchant(expense.merchant);
    setEditAmount(expense.amount.toString());
    setEditMemo(expense.memo || '');
    setEditCategory(expense.category);
    setShowDeleteConfirm(false);
  }, [expense]);

  const handleSaveEdit = async () => {
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
      await onSave(updates);
    }

    onClose();
  };

  const handleDelete = async () => {
    if (onDelete) {
      await onDelete(expense.id);
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-[10000] flex items-start justify-center pt-16 px-4 pb-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-800">지출 수정</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 날짜/시간 정보 */}
        <div className="text-sm text-slate-500 mb-4">
          {expense.date} {expense.time && `· ${expense.time}`}
          {expense.cardLastFour && ` · ${expense.cardLastFour}`}
        </div>

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
            <AmountInput
              value={editAmount}
              onChange={setEditAmount}
            />
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
        </div>

        {/* 삭제 확인 */}
        {showDeleteConfirm ? (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl">
            <p className="text-sm text-red-700 mb-3">
              정말 삭제하시겠습니까?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2 px-4 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 py-2 px-4 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                삭제
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* 삭제 버튼 */}
            {onDelete && (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full mt-4 py-2 px-4 border border-red-300 text-red-500 rounded-lg hover:bg-red-50 transition-colors"
              >
                삭제
              </button>
            )}

            {/* 저장/취소 버튼 */}
            <div className="flex gap-3 mt-4">
              <button
                onClick={onClose}
                className="flex-1 py-2 px-4 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleSaveEdit}
                className="flex-1 py-2 px-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                저장
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
