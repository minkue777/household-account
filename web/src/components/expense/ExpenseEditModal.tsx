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
  onCancelSplitGroup?: () => void;
  onUpdateSplitGroup?: (newMonths: number) => void;
  onDelete?: () => void;
  onNotifyPartner?: () => void;
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
  onCancelSplitGroup,
  onUpdateSplitGroup,
  onDelete,
  onNotifyPartner,
}: ExpenseEditModalProps) {
  const { getCategoryLabel } = useCategoryContext();

  const [editMerchant, setEditMerchant] = useState(expense.merchant);
  const [editAmount, setEditAmount] = useState(expense.amount.toString());
  const [editMemo, setEditMemo] = useState(expense.memo || '');
  const [editCategory, setEditCategory] = useState(expense.category);
  const [rememberMerchant, setRememberMerchant] = useState(false);
  const [splitMonthsInput, setSplitMonthsInput] = useState('2');
  const [showSplitInput, setShowSplitInput] = useState(false);
  const [splitMonthsError, setSplitMonthsError] = useState(false);
  const [editSplitMonths, setEditSplitMonths] = useState(expense.splitTotal || 2);
  const [showEditSplitGroup, setShowEditSplitGroup] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // 모달이 열릴 때 상태 초기화
  useEffect(() => {
    if (isOpen) {
      setEditMerchant(expense.merchant);
      setEditAmount(expense.amount.toString());
      setEditMemo(expense.memo || '');
      setEditCategory(expense.category);
      setRememberMerchant(false);
      setSplitMonthsInput('2');
      setShowSplitInput(false);
      setSplitMonthsError(false);
      setEditSplitMonths(expense.splitTotal || 2);
      setShowEditSplitGroup(false);
      setShowDeleteConfirm(false);
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
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-[9999] flex items-start justify-center pt-16 px-4 pb-4 overflow-y-auto"
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
                {onSplitMonths && !expense.splitGroupId && (
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

          {/* 월별 분할 그룹 관리 */}
          {expense.splitGroupId && (onCancelSplitGroup || onUpdateSplitGroup) && (
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
                        if (onUpdateSplitGroup && confirm(`전체 분할을 ${editSplitMonths}개월로 변경하시겠습니까?`)) {
                          onUpdateSplitGroup(editSplitMonths);
                          onClose();
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
                  {onUpdateSplitGroup && (
                    <button
                      onClick={() => setShowEditSplitGroup(true)}
                      className="flex-1 py-2 px-3 border border-purple-300 rounded-lg text-purple-600 text-sm hover:bg-purple-100"
                    >
                      개월 수 변경
                    </button>
                  )}
                  {onCancelSplitGroup && (
                    <button
                      onClick={() => {
                        onCancelSplitGroup();
                        onClose();
                      }}
                      className="flex-1 py-2 px-3 bg-amber-500 text-white rounded-lg text-sm hover:bg-amber-600"
                    >
                      분할 취소
                    </button>
                  )}
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
                  onClick={() => {
                    onDelete?.();
                    onClose();
                  }}
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
                {onOpenSplit && !expense.splitGroupId && (
                  <button
                    onClick={() => {
                      onClose();
                      onOpenSplit();
                    }}
                    className="flex-1 py-2.5 px-4 bg-slate-200 text-slate-800 rounded-xl hover:bg-slate-300 transition-colors font-medium"
                  >
                    지출 내역 분리
                  </button>
                )}
                {onNotifyPartner && (
                  <button
                    onClick={() => {
                      onNotifyPartner();
                      onClose();
                    }}
                    className="flex-1 py-2.5 px-4 bg-slate-200 text-slate-800 rounded-xl hover:bg-slate-300 transition-colors font-medium"
                  >
                    또니에게 전송
                  </button>
                )}
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
                {showSplitInput && onSplitMonths ? (
                  <button
                    onClick={() => {
                      const months = parseInt(splitMonthsInput, 10);
                      if (isNaN(months) || months < 2) {
                        alert('2개월 이상부터 분할할 수 있습니다.');
                        return;
                      }
                      onSplitMonths(months);
                      onClose();
                    }}
                    className="flex-1 py-2.5 px-4 bg-purple-500 text-white rounded-xl hover:bg-purple-600 transition-colors font-medium"
                  >
                    분할 적용
                  </button>
                ) : (
                  <button
                    onClick={handleSave}
                    className="flex-1 py-2.5 px-4 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-colors font-medium"
                  >
                    저장
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Portal>
  );
}
