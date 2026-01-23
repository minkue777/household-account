'use client';

import { useState } from 'react';
import { Expense, Category, CATEGORY_LABELS, CATEGORY_COLORS } from '@/types/expense';

interface ExpenseDetailProps {
  date: string;
  expenses: Expense[];
  onCategoryChange?: (expenseId: string, category: string) => void;
  onSaveMerchantRule?: (merchantName: string, category: string) => void;
  onDelete?: (expenseId: string) => void;
}

export default function ExpenseDetail({ date, expenses, onCategoryChange, onSaveMerchantRule, onDelete }: ExpenseDetailProps) {
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
        <h3 className="text-lg font-semibold text-slate-800 mb-4">
          {formatDate(date)}
        </h3>
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
        <span className="text-lg font-bold text-slate-800">
          {total.toLocaleString()}원
        </span>
      </div>

      <div className="space-y-3">
        {expenses.map((expense) => (
          <ExpenseItem
            key={expense.id}
            expense={expense}
            onCategoryChange={onCategoryChange}
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
  onCategoryChange?: (expenseId: string, category: string) => void;
  onSaveMerchantRule?: (merchantName: string, category: string) => void;
  onDelete?: (expenseId: string) => void;
}

function ExpenseItem({ expense, onCategoryChange, onSaveMerchantRule, onDelete }: ExpenseItemProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [showRememberDialog, setShowRememberDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const categories: Category[] = ['living', 'childcare', 'fixed', 'food', 'etc'];

  return (
    <div className="relative">
      <div
        onClick={() => setShowMenu(!showMenu)}
        className="flex items-center justify-between p-3 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3">
          {/* 카테고리 아이콘 */}
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-medium"
            style={{ backgroundColor: CATEGORY_COLORS[expense.category] }}
          >
            {CATEGORY_LABELS[expense.category].slice(0, 2)}
          </div>
          <div>
            <div className="font-medium text-slate-800">
              {expense.merchant}
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>{CATEGORY_LABELS[expense.category]}</span>
              <span>•</span>
              <span>
                {expense.cardType === 'main' ? '본인카드' : '가족카드'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
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

      {/* 카테고리 변경 메뉴 */}
      {showMenu && onCategoryChange && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl shadow-lg border border-slate-200 z-10 overflow-hidden">
          <div className="p-2 text-xs text-slate-500 border-b border-slate-100">
            카테고리 변경
          </div>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => {
                if (cat !== expense.category) {
                  onCategoryChange(expense.id, cat);
                  setSelectedCategory(cat);
                  setShowMenu(false);
                  setShowRememberDialog(true);
                } else {
                  setShowMenu(false);
                }
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 transition-colors ${
                expense.category === cat ? 'bg-slate-100' : ''
              }`}
            >
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: CATEGORY_COLORS[cat] }}
              />
              <span className="text-sm">{CATEGORY_LABELS[cat]}</span>
            </button>
          ))}
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
              &quot;{expense.merchant}&quot;을(를) {CATEGORY_LABELS[selectedCategory as Category]}(으)로 기억할까요?
              <br /><br />
              <span className="text-sm text-slate-500">
                다음에 같은 가맹점에서 결제하면 자동으로 {CATEGORY_LABELS[selectedCategory as Category]}(으)로 분류됩니다.
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
