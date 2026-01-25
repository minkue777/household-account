'use client';

import { useState } from 'react';
import { Expense } from '@/types/expense';
import { useCategoryContext } from '@/contexts/CategoryContext';
import { SplitItem } from '@/lib/expenseService';

interface ExpenseDetailProps {
  date: string;
  expenses: Expense[];
  onExpenseUpdate?: (expenseId: string, data: { amount?: number; memo?: string; category?: string; merchant?: string }) => void;
  onSaveMerchantRule?: (merchantName: string, category: string) => void;
  onDelete?: (expenseId: string) => void;
  onAddExpense?: () => void;
  onSplitExpense?: (expense: Expense, splits: SplitItem[]) => void;
  onMergeExpenses?: (targetExpense: Expense, sourceExpense: Expense) => void;
  onUnmergeExpense?: (expense: Expense) => void;
}

export default function ExpenseDetail({ date, expenses, onExpenseUpdate, onSaveMerchantRule, onDelete, onAddExpense, onSplitExpense, onMergeExpenses, onUnmergeExpense }: ExpenseDetailProps) {
  const total = expenses.reduce((sum, e) => sum + e.amount, 0);

  // 날짜 포맷팅
  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return `${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
  };

  if (expenses.length === 0) {
    return (
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-white/50 p-6 animate-slideDown">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-800">
            {formatDate(date)}
          </h3>
          {onAddExpense && (
            <button
              onClick={onAddExpense}
              className="p-2 text-slate-500 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          )}
        </div>
        <div className="text-center py-8 text-slate-400">
          지출 내역이 없습니다
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-white/50 p-6 animate-slideDown">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-slate-800">
          {formatDate(date)}
        </h3>
        {onAddExpense && (
          <button
            onClick={onAddExpense}
            className="p-2 text-slate-500 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        )}
      </div>

      <div className="space-y-3">
        {expenses.map((expense) => (
          <ExpenseItem
            key={expense.id}
            expense={expense}
            allExpenses={expenses}
            onExpenseUpdate={onExpenseUpdate}
            onSaveMerchantRule={onSaveMerchantRule}
            onDelete={onDelete}
            onSplitExpense={onSplitExpense}
            onMergeExpenses={onMergeExpenses}
            onUnmergeExpense={onUnmergeExpense}
          />
        ))}
      </div>
    </div>
  );
}

interface ExpenseItemProps {
  expense: Expense;
  allExpenses: Expense[];
  onExpenseUpdate?: (expenseId: string, data: { amount?: number; memo?: string; category?: string; merchant?: string }) => void;
  onSaveMerchantRule?: (merchantName: string, category: string) => void;
  onDelete?: (expenseId: string) => void;
  onSplitExpense?: (expense: Expense, splits: SplitItem[]) => void;
  onMergeExpenses?: (targetExpense: Expense, sourceExpense: Expense) => void;
  onUnmergeExpense?: (expense: Expense) => void;
}

function ExpenseItem({ expense, allExpenses, onExpenseUpdate, onSaveMerchantRule, onDelete, onSplitExpense, onMergeExpenses, onUnmergeExpense }: ExpenseItemProps) {
  const { activeCategories, getCategoryLabel, getCategoryColor } = useCategoryContext();

  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  // 편집 폼 상태
  const [editMerchant, setEditMerchant] = useState(expense.merchant);
  const [editAmount, setEditAmount] = useState(expense.amount.toString());
  const [editMemo, setEditMemo] = useState(expense.memo || '');
  const [editCategory, setEditCategory] = useState(expense.category);
  const [rememberMerchant, setRememberMerchant] = useState(false);

  // 분할 폼 상태
  const [splits, setSplits] = useState<SplitItem[]>([
    { merchant: expense.merchant, amount: Math.floor(expense.amount / 2), category: expense.category, memo: '' },
    { merchant: expense.merchant, amount: expense.amount - Math.floor(expense.amount / 2), category: expense.category, memo: '' },
  ]);

  const expenseColor = getCategoryColor(expense.category);
  const expenseLabel = getCategoryLabel(expense.category);

  // 드래그 앤 드롭 핸들러
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('expense-id', expense.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.types.includes('expense-id');
    if (draggedId) {
      setIsDragOver(true);
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const sourceId = e.dataTransfer.getData('expense-id');

    if (sourceId && sourceId !== expense.id && onMergeExpenses) {
      const sourceExpense = allExpenses.find((exp) => exp.id === sourceId);
      if (sourceExpense) {
        onMergeExpenses(expense, sourceExpense);
      }
    }
  };

  // 분할 모달 열기
  const handleOpenSplit = () => {
    setSplits([
      { merchant: expense.merchant, amount: Math.floor(expense.amount / 2), category: expense.category, memo: '' },
      { merchant: expense.merchant, amount: expense.amount - Math.floor(expense.amount / 2), category: expense.category, memo: '' },
    ]);
    setSplitAmountInputs({});
    setShowEditModal(false);
    setShowSplitModal(true);
  };

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
  const [splitAmountInputs, setSplitAmountInputs] = useState<Record<number, string>>({});

  const handleAmountInputChange = (index: number, value: string) => {
    // 빈 문자열이면 빈 상태 유지
    if (value === '') {
      setSplitAmountInputs({ ...splitAmountInputs, [index]: '' });
      handleUpdateSplit(index, 'amount', 0);
      return;
    }
    // 숫자만 허용하고 앞의 0 제거
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
    if (!onSplitExpense) return;
    const totalSplit = splits.reduce((sum, s) => sum + s.amount, 0);
    if (totalSplit !== expense.amount) {
      alert(`분할 금액의 합(${totalSplit.toLocaleString()}원)이 원래 금액(${expense.amount.toLocaleString()}원)과 일치하지 않습니다.`);
      return;
    }
    if (splits.some((s) => s.amount <= 0)) {
      alert('모든 분할 항목의 금액은 0보다 커야 합니다.');
      return;
    }
    onSplitExpense(expense, splits);
    setShowSplitModal(false);
  };

  const handleOpenEdit = () => {
    setEditMerchant(expense.merchant);
    setEditAmount(expense.amount.toString());
    setEditMemo(expense.memo || '');
    setEditCategory(expense.category);
    setRememberMerchant(false);
    setShowEditModal(true);
  };

  const handleSaveEdit = () => {
    if (!onExpenseUpdate) return;

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
      onExpenseUpdate(expense.id, updates);
    }

    // 카테고리가 변경되었고 기억하기 체크했으면 규칙 저장
    if (editCategory !== expense.category && rememberMerchant && onSaveMerchantRule) {
      onSaveMerchantRule(editMerchant.trim(), editCategory);
    }

    setShowEditModal(false);
  };

  return (
    <div className="relative">
      <div
        draggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleOpenEdit}
        className={`flex items-center justify-between p-3 rounded-xl transition-colors cursor-pointer ${
          isDragOver
            ? 'bg-blue-100 border-2 border-blue-400 border-dashed'
            : 'bg-slate-50 hover:bg-slate-100'
        }`}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* 카테고리 아이콘 */}
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0"
            style={{ backgroundColor: expenseColor }}
          >
            {expenseLabel.slice(0, 2)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium text-slate-800 truncate">
              {expense.merchant}
            </div>
            {expense.memo && (
              <div className="text-xs text-slate-500 truncate">
                {expense.memo}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          <div className="font-semibold text-slate-800">
            {expense.amount.toLocaleString()}원
          </div>
          {/* 삭제 버튼 */}
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowDeleteDialog(true);
              }}
              className="p-1 text-slate-400 hover:text-red-500 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 편집 모달 */}
      {showEditModal && (
        <div
          className="fixed top-0 left-0 right-0 bottom-0 bg-slate-900/20 backdrop-blur-sm z-[9999] flex items-center justify-center p-4"
          style={{ position: 'fixed' }}
          onClick={() => setShowEditModal(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl max-h-[90vh] overflow-y-auto"
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

            {/* 합쳐진 지출 되돌리기 */}
            {expense.mergedFrom && expense.mergedFrom.length > 0 && onUnmergeExpense && (
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
                      onUnmergeExpense(expense);
                      setShowEditModal(false);
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
            {onSplitExpense && (
              <button
                onClick={handleOpenSplit}
                className="w-full py-2 px-4 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors flex items-center justify-center gap-2 mt-4"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
                나누기
              </button>
            )}

            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setShowEditModal(false)}
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
          </div>
        </div>
      )}

      {/* 삭제 확인 다이얼로그 */}
      {showDeleteDialog && (
        <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 m-4 max-w-sm w-full shadow-xl">
            <h3 className="text-lg font-semibold text-slate-800 mb-3">
              삭제 확인
            </h3>
            <p className="text-slate-600 mb-6">
              &quot;{expense.merchant}&quot; {expense.amount.toLocaleString()}원을 삭제하시겠습니까?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteDialog(false)}
                className="flex-1 py-2 px-4 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
              >
                취소
              </button>
              <button
                onClick={() => {
                  if (onDelete) {
                    onDelete(expense.id);
                  }
                  setShowDeleteDialog(false);
                }}
                className="flex-1 py-2 px-4 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 분할 모달 */}
      {showSplitModal && (
        <div
          className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setShowSplitModal(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 max-w-lg w-full shadow-xl max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-slate-800 mb-2">
              지출 나누기
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
                        onFocus={(e) => {
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
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">카테고리</label>
                    <div className="flex flex-wrap gap-2">
                      {activeCategories.map((cat) => (
                        <button
                          key={cat.key}
                          type="button"
                          onClick={() => handleUpdateSplit(index, 'category', cat.key)}
                          className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border transition-colors text-xs ${
                            split.category === cat.key
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: cat.color }}
                          />
                          <span className="text-slate-700">{cat.label}</span>
                        </button>
                      ))}
                    </div>
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
                onClick={() => setShowSplitModal(false)}
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
      )}
    </div>
  );
}
