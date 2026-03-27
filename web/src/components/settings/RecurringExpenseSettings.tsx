'use client';

import { useState, useEffect, useRef } from 'react';
import { useCategoryContext } from '@/contexts/CategoryContext';
import { useHousehold } from '@/contexts/HouseholdContext';
import {
  RecurringExpense,
  subscribeToRecurringExpenses,
  addRecurringExpense,
  updateRecurringExpense,
  deleteRecurringExpense,
} from '@/lib/recurringExpenseService';

export default function RecurringExpenseSettings() {
  const {
    activeCategories,
    getCategoryLabel,
    getCategoryColor,
  } = useCategoryContext();
  const { householdKey } = useHousehold();

  // 섹션 펼침/접힘 상태
  const [isRecurringOpen, setIsRecurringOpen] = useState(false);

  // 정기 지출 상태
  const [recurringExpenses, setRecurringExpenses] = useState<RecurringExpense[]>([]);
  const [recurringLoading, setRecurringLoading] = useState(true);
  const [showAddRecurringForm, setShowAddRecurringForm] = useState(false);
  const [editingRecurringId, setEditingRecurringId] = useState<string | null>(null);
  const recurringFormRef = useRef<HTMLDivElement>(null);

  // 정기 지출 폼 상태
  const [recurringMerchant, setRecurringMerchant] = useState('');
  const [recurringAmount, setRecurringAmount] = useState('');
  const [recurringCategory, setRecurringCategory] = useState('');
  const [recurringDay, setRecurringDay] = useState('');
  const [recurringMemo, setRecurringMemo] = useState('');

  // 정기 지출 구독
  useEffect(() => {
    if (!householdKey) {
      setRecurringExpenses([]);
      setRecurringLoading(false);
      return () => {};
    }

    setRecurringLoading(true);

    const unsubscribeRecurring = subscribeToRecurringExpenses(householdKey, (expenses) => {
      setRecurringExpenses(expenses);
      setRecurringLoading(false);
    });

    return () => {
      unsubscribeRecurring();
    };
  }, [householdKey]);

  // 정기 지출 핸들러
  const resetRecurringForm = () => {
    setRecurringMerchant('');
    setRecurringAmount('');
    setRecurringCategory('');
    setRecurringDay('');
    setRecurringMemo('');
    setEditingRecurringId(null);
    setShowAddRecurringForm(false);
  };

  const handleStartEditRecurring = (expense: RecurringExpense) => {
    setEditingRecurringId(expense.id);
    setRecurringMerchant(expense.merchant);
    setRecurringAmount(expense.amount.toString());
    setRecurringCategory(expense.category);
    setRecurringDay(expense.dayOfMonth.toString());
    setRecurringMemo(expense.memo || '');
    setShowAddRecurringForm(false);
    setTimeout(() => {
      recurringFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  const handleSaveRecurring = async () => {
    if (!recurringMerchant.trim() || !recurringAmount || !recurringCategory || !recurringDay) return;
    if (!householdKey) return;
    const amount = parseInt(recurringAmount, 10);
    const dayOfMonth = parseInt(recurringDay, 10);

    if (isNaN(amount) || isNaN(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) return;

    if (editingRecurringId) {
      await updateRecurringExpense(editingRecurringId, {
        merchant: recurringMerchant.trim(),
        amount,
        category: recurringCategory,
        dayOfMonth,
        memo: recurringMemo.trim(),
      });
    } else {
      await addRecurringExpense(householdKey, {
        merchant: recurringMerchant.trim(),
        amount,
        category: recurringCategory,
        dayOfMonth,
        memo: recurringMemo.trim(),
      });
    }

    resetRecurringForm();
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <button
        onClick={() => setIsRecurringOpen(!isRecurringOpen)}
        className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="text-left">
            <div className="font-semibold text-slate-800">정기 지출</div>
            <div className="text-sm text-slate-500">
              {recurringLoading ? '로딩중...' : `${recurringExpenses.length}개`}
            </div>
          </div>
        </div>
        <svg
          className={`w-5 h-5 text-slate-400 transition-transform ${isRecurringOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isRecurringOpen && (
        <div className="border-t border-slate-100">
          {/* 추가/편집 폼 */}
          {(showAddRecurringForm || editingRecurringId) && (
            <div ref={recurringFormRef} className="scroll-mt-24 p-4 bg-slate-50 border-b border-slate-200">
              <div className="space-y-4">
                <div className="font-medium text-slate-800">
                  {editingRecurringId ? '정기 지출 편집' : '새 정기 지출 추가'}
                </div>

                {/* 가맹점명 */}
                <div>
                  <label className="block text-sm text-slate-600 mb-1">가맹점명</label>
                  <input
                    type="text"
                    value={recurringMerchant}
                    onChange={(e) => setRecurringMerchant(e.target.value)}
                    placeholder="예: 삼성생명"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* 금액 */}
                <div>
                  <label className="block text-sm text-slate-600 mb-1">금액</label>
                  <div className="relative">
                    <input
                      type="number"
                      value={recurringAmount}
                      onChange={(e) => setRecurringAmount(e.target.value)}
                      placeholder="50000"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 pr-10"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">원</span>
                  </div>
                </div>

                {/* 결제일 */}
                <div>
                  <label className="block text-sm text-slate-600 mb-1">결제일</label>
                  <div className="relative">
                    <input
                      type="number"
                      min="1"
                      max="31"
                      value={recurringDay}
                      onChange={(e) => setRecurringDay(e.target.value)}
                      placeholder="15"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 pr-10"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">일</span>
                  </div>
                </div>

                {/* 카테고리 */}
                <div>
                  <label className="block text-sm text-slate-600 mb-1">카테고리</label>
                  <div className="grid grid-cols-5 gap-2">
                    {activeCategories.map((cat) => (
                      <button
                        key={cat.key}
                        type="button"
                        onClick={() => setRecurringCategory(cat.key)}
                        className={`flex flex-col items-center p-2 rounded-lg border-2 transition-colors ${
                          recurringCategory === cat.key
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div
                          className="w-6 h-6 rounded-full mb-1"
                          style={{ backgroundColor: cat.color }}
                        />
                        <span className="text-xs text-slate-700">{cat.label.slice(0, 3)}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 메모 */}
                <div>
                  <label className="block text-sm text-slate-600 mb-1">
                    메모 <span className="text-slate-400">(선택)</span>
                  </label>
                  <input
                    type="text"
                    value={recurringMemo}
                    onChange={(e) => setRecurringMemo(e.target.value)}
                    placeholder="예: 보험료"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* 버튼 */}
                <div className="flex gap-2">
                  <button
                    onClick={resetRecurringForm}
                    className="flex-1 py-2 px-4 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    취소
                  </button>
                  <button
                    onClick={handleSaveRecurring}
                    disabled={!recurringMerchant.trim() || !recurringAmount || !recurringCategory || !recurringDay}
                    className="flex-1 py-2 px-4 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {editingRecurringId ? '저장' : '추가'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {recurringLoading ? (
            <div className="p-8 text-center text-slate-400">로딩중...</div>
          ) : recurringExpenses.length === 0 && !showAddRecurringForm ? (
            <div className="p-8 text-center text-slate-400">
              등록된 정기 지출이 없습니다.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {recurringExpenses.map((expense) => (
                <div key={expense.id} className={`p-4 ${editingRecurringId === expense.id ? 'hidden' : ''}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0"
                        style={{ backgroundColor: getCategoryColor(expense.category) }}
                      >
                        {getCategoryLabel(expense.category).slice(0, 2)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-slate-800 flex items-center gap-2">
                          <span className="truncate">{expense.merchant}</span>
                          {!expense.isActive && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-slate-200 text-slate-500 flex-shrink-0">
                              비활성
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-slate-500">
                          매월 {expense.dayOfMonth}일 · {expense.amount.toLocaleString()}원
                        </div>
                        {expense.memo && (
                          <div className="text-sm text-slate-400 truncate">
                            {expense.memo}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {/* 활성화/비활성화 토글 */}
                      <button
                        onClick={async () => {
                          await updateRecurringExpense(expense.id, { isActive: !expense.isActive });
                        }}
                        className={`p-2 rounded-lg transition-colors ${
                          expense.isActive
                            ? 'text-purple-500 hover:bg-purple-50'
                            : 'text-slate-400 hover:bg-slate-100'
                        }`}
                        title={expense.isActive ? '비활성화' : '활성화'}
                      >
                        {expense.isActive ? (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <circle cx="12" cy="12" r="9" strokeWidth={2} />
                          </svg>
                        )}
                      </button>
                      <button
                        onClick={() => handleStartEditRecurring(expense)}
                        className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={async () => {
                          if (confirm(`"${expense.merchant}" 정기 지출을 삭제하시겠습니까?`)) {
                            await deleteRecurringExpense(expense.id);
                          }
                        }}
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 추가 버튼 */}
          {!showAddRecurringForm && !editingRecurringId && (
            <button
              onClick={() => setShowAddRecurringForm(true)}
              className="w-full p-4 border-t border-slate-200 flex items-center justify-center gap-2 text-purple-600 hover:bg-purple-50 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="font-medium">새 정기 지출 추가</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
