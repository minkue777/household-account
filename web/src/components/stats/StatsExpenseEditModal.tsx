'use client';

import { useState } from 'react';
import { Expense } from '@/types/expense';
import { useCategoryContext } from '@/contexts/CategoryContext';
import { ConfirmDialog } from '@/components/common';

interface StatsExpenseEditModalProps {
  expense: Expense;
  onClose: () => void;
  onSave: (expense: Expense, updates: { amount?: number; memo?: string; category?: string }, rememberMerchant: boolean) => void;
  onDelete: (expense: Expense) => void;
}

export default function StatsExpenseEditModal({
  expense,
  onClose,
  onSave,
  onDelete,
}: StatsExpenseEditModalProps) {
  const { activeCategories, getCategoryLabel } = useCategoryContext();

  const [editAmount, setEditAmount] = useState(expense.amount.toString());
  const [editMemo, setEditMemo] = useState(expense.memo || '');
  const [editCategory, setEditCategory] = useState(expense.category);
  const [rememberMerchant, setRememberMerchant] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const handleSave = () => {
    const newAmount = parseInt(editAmount, 10);
    if (isNaN(newAmount) || newAmount <= 0) return;

    const updates: { amount?: number; memo?: string; category?: string } = {};

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
      onSave(expense, updates, rememberMerchant);
    }

    onClose();
  };

  const handleDelete = () => {
    onDelete(expense);
    setShowDeleteDialog(false);
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center z-[60] p-4"
        onClick={onClose}
      >
        <div
          className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl max-h-[85vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="text-lg font-semibold text-slate-800 mb-4">
            지출 수정
          </h3>

          <div className="space-y-4">
            {/* 가맹점명 (읽기 전용) */}
            <div>
              <label className="block text-sm font-medium text-slate-500 mb-1">
                가맹점
              </label>
              <div className="px-3 py-2 bg-slate-100 rounded-lg text-slate-700">
                {expense.merchant}
              </div>
            </div>

            {/* 날짜 (읽기 전용) */}
            <div>
              <label className="block text-sm font-medium text-slate-500 mb-1">
                날짜
              </label>
              <div className="px-3 py-2 bg-slate-100 rounded-lg text-slate-700">
                {expense.date}
              </div>
            </div>

            {/* 금액 */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                금액
              </label>
              <div className="relative">
                <input
                  type="number"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 pr-10"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                  원
                </span>
              </div>
            </div>

            {/* 카테고리 */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                카테고리
              </label>
              <div className="flex flex-wrap gap-2">
                {activeCategories.map((cat) => (
                  <button
                    key={cat.key}
                    type="button"
                    onClick={() => setEditCategory(cat.key)}
                    className={`flex flex-col items-center p-2 rounded-lg border-2 transition-colors min-w-[56px] ${
                      editCategory === cat.key
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

          {/* 삭제 버튼 */}
          <button
            onClick={() => setShowDeleteDialog(true)}
            className="w-full py-2 px-4 border border-red-300 text-red-500 rounded-lg hover:bg-red-50 transition-colors mt-4"
          >
            삭제
          </button>

          <div className="flex gap-3 mt-4">
            <button
              onClick={onClose}
              className="flex-1 py-2 px-4 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleSave}
              className="flex-1 py-2 px-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
            >
              저장
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={showDeleteDialog}
        title="삭제 확인"
        message={`"${expense.merchant}" ${expense.amount.toLocaleString()}원을 삭제하시겠습니까?`}
        confirmLabel="삭제"
        cancelLabel="취소"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteDialog(false)}
      />
    </>
  );
}
