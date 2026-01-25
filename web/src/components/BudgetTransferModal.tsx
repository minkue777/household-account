'use client';

import { useState, useEffect } from 'react';
import { useCategoryContext } from '@/contexts/CategoryContext';
import { BudgetTransfer, addBudgetTransfer, deleteBudgetTransfer, subscribeToMonthlyBudgetTransfers, calculateBudgetAdjustments } from '@/lib/budgetTransferService';
import { getStoredHouseholdKey } from '@/lib/householdService';
import Portal from './Portal';

interface BudgetTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  year: number;
  month: number;
}

export default function BudgetTransferModal({ isOpen, onClose, year, month }: BudgetTransferModalProps) {
  const { activeCategories, getCategoryLabel, getCategoryColor, getCategoryBudget } = useCategoryContext();
  const [transfers, setTransfers] = useState<BudgetTransfer[]>([]);
  const [fromCategory, setFromCategory] = useState('');
  const [toCategory, setToCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [householdId, setHouseholdId] = useState('');

  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;

  // householdId 가져오기
  useEffect(() => {
    setHouseholdId(getStoredHouseholdKey());
  }, []);

  // 예산이 있는 카테고리만 필터링
  const categoriesWithBudget = activeCategories.filter(
    (cat) => getCategoryBudget(cat.key) !== null && getCategoryBudget(cat.key)! > 0
  );

  // 예산 이동 목록 구독
  useEffect(() => {
    if (!isOpen || !householdId) return;

    const unsubscribe = subscribeToMonthlyBudgetTransfers(householdId, yearMonth, setTransfers);
    return () => unsubscribe();
  }, [isOpen, yearMonth, householdId]);

  // 모달 열릴 때 초기화
  useEffect(() => {
    if (isOpen) {
      setFromCategory('');
      setToCategory('');
      setAmount('');
      setMemo('');
      setIsAdding(false);
    }
  }, [isOpen]);

  // 조정값 계산
  const adjustments = calculateBudgetAdjustments(transfers);

  // 예산 이동 추가
  const handleAdd = async () => {
    if (!fromCategory || !toCategory || !amount || !householdId) return;
    if (fromCategory === toCategory) return;

    const amountNum = parseInt(amount, 10);
    if (isNaN(amountNum) || amountNum <= 0) return;

    try {
      await addBudgetTransfer(householdId, yearMonth, fromCategory, toCategory, amountNum, memo);
      setFromCategory('');
      setToCategory('');
      setAmount('');
      setMemo('');
      setIsAdding(false);
    } catch (error) {
      console.error('예산 이동 추가 실패:', error);
    }
  };

  // 예산 이동 삭제
  const handleDelete = async (id: string) => {
    try {
      await deleteBudgetTransfer(id);
    } catch (error) {
      console.error('예산 이동 삭제 실패:', error);
    }
  };

  if (!isOpen) return null;

  return (
    <Portal>
      <div
        className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-[9999] flex items-start justify-center pt-12 md:pt-20 px-4 pb-4 overflow-y-auto"
        onClick={onClose}
      >
        <div
          className="bg-white rounded-2xl shadow-xl max-w-lg w-full overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 헤더 */}
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-800">예산 조정</h3>
              <p className="text-sm text-slate-500">{year}년 {month}월</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* 현재 예산 현황 */}
          <div className="p-4 bg-slate-50 border-b border-slate-100">
            <h4 className="text-sm font-medium text-slate-600 mb-3">카테고리별 예산 현황</h4>
            <div className="space-y-2">
              {categoriesWithBudget.map((cat) => {
                const originalBudget = getCategoryBudget(cat.key) || 0;
                const adjustment = adjustments[cat.key] || 0;
                const effectiveBudget = originalBudget + adjustment;

                return (
                  <div key={cat.key} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: cat.color }}
                      />
                      <span className="text-slate-700">{cat.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {adjustment !== 0 && (
                        <span className={`text-xs ${adjustment > 0 ? 'text-green-600' : 'text-red-500'}`}>
                          ({adjustment > 0 ? '+' : ''}{adjustment.toLocaleString()})
                        </span>
                      )}
                      <span className="font-medium text-slate-800">
                        {effectiveBudget.toLocaleString()}원
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 이동 내역 */}
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-slate-600">이동 내역</h4>
              {!isAdding && (
                <button
                  onClick={() => setIsAdding(true)}
                  className="text-sm text-blue-500 hover:text-blue-600 flex items-center gap-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  추가
                </button>
              )}
            </div>

            {/* 이동 추가 폼 */}
            {isAdding && (
              <div className="mb-4 p-4 bg-blue-50 rounded-xl space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  {/* From 카테고리 */}
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">보내는 카테고리</label>
                    <select
                      value={fromCategory}
                      onChange={(e) => setFromCategory(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">선택</option>
                      {categoriesWithBudget.map((cat) => (
                        <option key={cat.key} value={cat.key}>
                          {cat.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* To 카테고리 */}
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">받는 카테고리</label>
                    <select
                      value={toCategory}
                      onChange={(e) => setToCategory(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">선택</option>
                      {categoriesWithBudget
                        .filter((cat) => cat.key !== fromCategory)
                        .map((cat) => (
                          <option key={cat.key} value={cat.key}>
                            {cat.label}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                {/* 금액 */}
                <div>
                  <label className="block text-xs text-slate-500 mb-1">이동 금액</label>
                  <div className="relative">
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 pr-8"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">원</span>
                  </div>
                </div>

                {/* 메모 */}
                <div>
                  <label className="block text-xs text-slate-500 mb-1">메모 (선택)</label>
                  <input
                    type="text"
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    placeholder="예: 육아비 여유분 이동"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* 버튼 */}
                <div className="flex gap-2">
                  <button
                    onClick={() => setIsAdding(false)}
                    className="flex-1 py-2 px-4 border border-slate-300 rounded-lg text-slate-600 hover:bg-white transition-colors text-sm"
                  >
                    취소
                  </button>
                  <button
                    onClick={handleAdd}
                    disabled={!fromCategory || !toCategory || !amount || fromCategory === toCategory}
                    className="flex-1 py-2 px-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    추가
                  </button>
                </div>
              </div>
            )}

            {/* 이동 목록 */}
            {transfers.length > 0 ? (
              <div className="space-y-2">
                {transfers.map((transfer) => (
                  <div
                    key={transfer.id}
                    className="flex items-center justify-between p-3 bg-slate-50 rounded-xl"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: getCategoryColor(transfer.fromCategory) }}
                        />
                        <span className="text-sm text-slate-600">
                          {getCategoryLabel(transfer.fromCategory)}
                        </span>
                      </div>
                      <svg className="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                      </svg>
                      <div className="flex items-center gap-1">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: getCategoryColor(transfer.toCategory) }}
                        />
                        <span className="text-sm text-slate-600">
                          {getCategoryLabel(transfer.toCategory)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                      <span className="text-sm font-medium text-slate-800">
                        {transfer.amount.toLocaleString()}원
                      </span>
                      <button
                        onClick={() => handleDelete(transfer.id)}
                        className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-slate-400 text-sm">
                이동 내역이 없습니다
              </div>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
