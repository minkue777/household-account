'use client';

import { useState, useEffect } from 'react';
import { Expense } from '@/types/expense';
import { SplitItem, addExpense, generateSplitGroupId, cancelSplitGroup, updateSplitGroup, notifyPartner } from '@/lib/expenseService';
import { CategorySelector, AmountInput } from '../common';
import ExpenseSplitModal from '../expense/ExpenseSplitModal';

interface SearchExpenseEditProps {
  expense: Expense;
  onClose: () => void;
  onSave: (updates: { amount?: number; memo?: string; category?: string; merchant?: string }) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onSplitExpense?: (expense: Expense, splits: SplitItem[]) => void;
}

export default function SearchExpenseEdit({
  expense,
  onClose,
  onSave,
  onDelete,
  onSplitExpense,
}: SearchExpenseEditProps) {
  const [editMerchant, setEditMerchant] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editMemo, setEditMemo] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [splitMonthsInput, setSplitMonthsInput] = useState('2');
  const [showSplitInput, setShowSplitInput] = useState(false);
  const [splitMonthsError, setSplitMonthsError] = useState(false);
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [editSplitMonths, setEditSplitMonths] = useState(expense.splitTotal || 2);
  const [showEditSplitGroup, setShowEditSplitGroup] = useState(false);

  // 선택된 지출이 변경되면 편집 폼 초기화
  useEffect(() => {
    setEditMerchant(expense.merchant);
    setEditAmount(expense.amount.toString());
    setEditMemo(expense.memo || '');
    setEditCategory(expense.category);
    setShowDeleteConfirm(false);
    setSplitMonthsInput('2');
    setShowSplitInput(false);
    setSplitMonthsError(false);
    setEditSplitMonths(expense.splitTotal || 2);
    setShowEditSplitGroup(false);
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

  // 월별 분할 처리 (여러 달에 걸쳐 분할)
  const handleSplitMonths = async (months: number) => {
    if (!onDelete) return;
    if (months < 2) {
      alert('2개월 이상부터 분할할 수 있습니다.');
      return;
    }

    const monthlyAmount = Math.floor(expense.amount / months);
    const baseDate = new Date(expense.date);
    const splitGroupId = generateSplitGroupId();

    try {
      // 분할된 지출 생성 (그룹 ID로 연결)
      for (let i = 0; i < months; i++) {
        const targetDate = new Date(baseDate);
        targetDate.setMonth(targetDate.getMonth() + i);
        const dateStr = targetDate.toISOString().split('T')[0];

        await addExpense({
          date: dateStr,
          time: expense.time || '09:00',
          merchant: `${expense.merchant} (${i + 1}/${months})`,
          amount: monthlyAmount,
          category: expense.category,
          cardType: expense.cardType || 'main',
          memo: expense.memo,
          splitGroupId,
          splitIndex: i + 1,
          splitTotal: months,
        });
      }

      // 기존 지출 삭제
      await onDelete(expense.id);
      onClose();
    } catch {
      alert('분할 처리 중 오류가 발생했습니다.');
    }
  };

  // 월별 분할 취소 (합치기)
  const handleCancelSplitGroup = async () => {
    if (!expense.splitGroupId) return;

    try {
      await cancelSplitGroup(expense.splitGroupId);
      onClose();
    } catch {
      alert('분할 취소 중 오류가 발생했습니다.');
    }
  };

  // 월별 분할 그룹 개월 수 변경
  const handleUpdateSplitGroup = async (newMonths: number) => {
    if (!expense.splitGroupId) return;

    try {
      await updateSplitGroup(expense.splitGroupId, newMonths);
      onClose();
    } catch {
      alert('수정 중 오류가 발생했습니다.');
    }
  };

  const handleSplitExpense = (splits: SplitItem[]) => {
    if (onSplitExpense) {
      onSplitExpense(expense, splits);
      onClose();
    }
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
            <div className="flex gap-2">
              <div className="flex-1">
                <AmountInput
                  value={editAmount}
                  onChange={setEditAmount}
                />
              </div>
              {onDelete && !expense.splitGroupId && (
                <button
                  type="button"
                  onClick={() => {
                    if (!showSplitInput) setSplitMonthsInput('2');
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
              )}
            </div>
            {showSplitInput && (
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
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9]/g, '');
                      setSplitMonthsInput(val);
                      const num = parseInt(val, 10);
                      setSplitMonthsError(val !== '' && !isNaN(num) && num < 2);
                    }}
                    className={`w-20 px-3 py-1.5 border rounded-lg focus:outline-none focus:ring-2 text-center ${
                      splitMonthsError
                        ? 'border-red-400 focus:ring-red-400'
                        : 'border-slate-300 focus:ring-purple-500'
                    }`}
                  />
                  <span className="text-sm text-slate-600">개월 분할</span>
                  <span className="text-sm text-purple-600 ml-auto">
                    월 {Math.floor(expense.amount / (parseInt(splitMonthsInput, 10) || 2)).toLocaleString()}원
                  </span>
                </div>
                {splitMonthsError && (
                  <p className="text-xs text-red-500 mt-1">2개월 이상부터 분할할 수 있습니다</p>
                )}
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
        </div>

        {/* 월별 분할 그룹 관리 */}
        {expense.splitGroupId && (
          <div className="mt-4 p-3 bg-purple-50 border border-purple-200 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-sm font-medium text-purple-800">
                월별 분할 ({expense.splitIndex}/{expense.splitTotal})
              </span>
            </div>

            {showEditSplitGroup ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="2"
                    max="24"
                    value={editSplitMonths}
                    onChange={(e) => setEditSplitMonths(Math.max(2, parseInt(e.target.value, 10) || 2))}
                    className="w-20 px-3 py-1.5 border border-purple-300 rounded-lg text-center"
                  />
                  <span className="text-sm text-purple-700">개월로 변경</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowEditSplitGroup(false)}
                    className="flex-1 py-1.5 px-3 border border-purple-300 rounded-lg text-purple-600 text-sm hover:bg-purple-100"
                  >
                    취소
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`전체 분할을 ${editSplitMonths}개월로 변경하시겠습니까?`)) {
                        handleUpdateSplitGroup(editSplitMonths);
                      }
                    }}
                    className="flex-1 py-1.5 px-3 bg-purple-500 text-white rounded-lg text-sm hover:bg-purple-600"
                  >
                    변경
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => setShowEditSplitGroup(true)}
                  className="flex-1 py-2 px-3 border border-purple-300 rounded-lg text-purple-600 text-sm hover:bg-purple-100"
                >
                  개월 수 변경
                </button>
                <button
                  onClick={() => {
                    handleCancelSplitGroup();
                  }}
                  className="flex-1 py-2 px-3 bg-amber-500 text-white rounded-lg text-sm hover:bg-amber-600"
                >
                  분할 취소
                </button>
              </div>
            )}
          </div>
        )}

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
          <div className="mt-4 space-y-2">
            {/* 1행: 연한 스타일 */}
            <div className="flex gap-2">
              {onSplitExpense && !expense.splitGroupId && (
                <button
                  onClick={() => setShowSplitModal(true)}
                  className="flex-1 py-2.5 px-4 bg-slate-200 text-slate-800 rounded-xl hover:bg-slate-300 transition-colors font-medium"
                >
                  지출 내역 분리
                </button>
              )}
              <button
                onClick={() => {
                  notifyPartner(expense.id);
                  onClose();
                }}
                className="flex-1 py-2.5 px-4 bg-slate-200 text-slate-800 rounded-xl hover:bg-slate-300 transition-colors font-medium"
              >
                또니에게 전송
              </button>
            </div>
            {/* 2행: 진한 스타일 */}
            <div className="flex gap-2">
              {onDelete && (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="flex-1 py-2.5 px-4 bg-slate-200 text-slate-800 rounded-xl hover:bg-slate-300 transition-colors font-medium"
                >
                  삭제
                </button>
              )}
              {showSplitInput ? (
                <button
                  onClick={() => {
                    const months = parseInt(splitMonthsInput, 10);
                    if (isNaN(months) || months < 2) {
                      alert('2개월 이상부터 분할할 수 있습니다.');
                      return;
                    }
                    handleSplitMonths(months);
                  }}
                  className="flex-1 py-2.5 px-4 bg-purple-500 text-white rounded-xl hover:bg-purple-600 transition-colors font-medium"
                >
                  분할 적용
                </button>
              ) : (
                <button
                  onClick={handleSaveEdit}
                  className="flex-1 py-2.5 px-4 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-colors font-medium"
                >
                  저장
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 분할 모달 */}
      <ExpenseSplitModal
        expense={expense}
        isOpen={showSplitModal}
        onClose={() => setShowSplitModal(false)}
        onSave={handleSplitExpense}
      />
    </div>
  );
}
