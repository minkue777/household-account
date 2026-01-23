'use client';

import { useState } from 'react';
import { Expense } from '@/types/expense';
import { useCategoryContext } from '@/contexts/CategoryContext';

interface ExpenseDetailProps {
  date: string;
  expenses: Expense[];
  onExpenseUpdate?: (expenseId: string, data: { amount?: number; memo?: string; category?: string }) => void;
  onSaveMerchantRule?: (merchantName: string, category: string) => void;
  onDelete?: (expenseId: string) => void;
  onAddExpense?: () => void;
}

export default function ExpenseDetail({ date, expenses, onExpenseUpdate, onSaveMerchantRule, onDelete, onAddExpense }: ExpenseDetailProps) {
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
              className="flex items-center gap-1 px-3 py-1.5 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              추가
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
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-slate-800">
            {total.toLocaleString()}원
          </span>
          {onAddExpense && (
            <button
              onClick={onAddExpense}
              className="flex items-center gap-1 px-3 py-1.5 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              추가
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {expenses.map((expense) => (
          <ExpenseItem
            key={expense.id}
            expense={expense}
            onExpenseUpdate={onExpenseUpdate}
            onSaveMerchantRule={onSaveMerchantRule}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  );
}

interface ExpenseItemProps {
  expense: Expense;
  onExpenseUpdate?: (expenseId: string, data: { amount?: number; memo?: string; category?: string }) => void;
  onSaveMerchantRule?: (merchantName: string, category: string) => void;
  onDelete?: (expenseId: string) => void;
}

function ExpenseItem({ expense, onExpenseUpdate, onSaveMerchantRule, onDelete }: ExpenseItemProps) {
  const { activeCategories, getCategoryLabel, getCategoryColor } = useCategoryContext();

  const [showEditModal, setShowEditModal] = useState(false);
  const [showRememberDialog, setShowRememberDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // 편집 폼 상태
  const [editAmount, setEditAmount] = useState(expense.amount.toString());
  const [editMemo, setEditMemo] = useState(expense.memo || '');
  const [editCategory, setEditCategory] = useState(expense.category);

  const expenseColor = getCategoryColor(expense.category);
  const expenseLabel = getCategoryLabel(expense.category);

  const handleOpenEdit = () => {
    setEditAmount(expense.amount.toString());
    setEditMemo(expense.memo || '');
    setEditCategory(expense.category);
    setShowEditModal(true);
  };

  const handleSaveEdit = () => {
    if (!onExpenseUpdate) return;

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
      setSelectedCategory(editCategory);
    }

    if (Object.keys(updates).length > 0) {
      onExpenseUpdate(expense.id, updates);
    }

    setShowEditModal(false);

    // 카테고리가 변경되었으면 기억할지 물어보기
    if (editCategory !== expense.category) {
      setShowRememberDialog(true);
    }
  };

  return (
    <div className="relative">
      <div
        onClick={handleOpenEdit}
        className="flex items-center justify-between p-3 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3">
          {/* 카테고리 아이콘 */}
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0"
            style={{ backgroundColor: expenseColor }}
          >
            {expenseLabel.slice(0, 2)}
          </div>
          <div className="min-w-0">
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
        <div className="flex items-center gap-2 flex-shrink-0">
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 m-4 max-w-md w-full shadow-xl">
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
                <div className="grid grid-cols-5 gap-2">
                  {activeCategories.map((cat) => (
                    <button
                      key={cat.key}
                      type="button"
                      onClick={() => setEditCategory(cat.key)}
                      className={`flex flex-col items-center p-2 rounded-lg border-2 transition-colors ${
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
            </div>

            <div className="flex gap-3 mt-6">
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

      {/* 기억할까요? 다이얼로그 */}
      {showRememberDialog && selectedCategory && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 m-4 max-w-sm w-full shadow-xl">
            <h3 className="text-lg font-semibold text-slate-800 mb-3">
              가맹점 기억하기
            </h3>
            <p className="text-slate-600 mb-6">
              &quot;{expense.merchant}&quot;을(를) {getCategoryLabel(selectedCategory)}(으)로 기억할까요?
              <br /><br />
              <span className="text-sm text-slate-500">
                다음에 같은 가맹점에서 결제하면 자동으로 {getCategoryLabel(selectedCategory)}(으)로 분류됩니다.
              </span>
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowRememberDialog(false);
                  setSelectedCategory(null);
                }}
                className="flex-1 py-2 px-4 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
              >
                아니오
              </button>
              <button
                onClick={() => {
                  if (onSaveMerchantRule && selectedCategory) {
                    onSaveMerchantRule(expense.merchant, selectedCategory);
                  }
                  setShowRememberDialog(false);
                  setSelectedCategory(null);
                }}
                className="flex-1 py-2 px-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                예
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 삭제 확인 다이얼로그 */}
      {showDeleteDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
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
    </div>
  );
}
