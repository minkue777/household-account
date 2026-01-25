'use client';

import { useState, useRef, useEffect } from 'react';
import { Expense } from '@/types/expense';
import { searchExpenses } from '@/lib/expenseService';
import { useCategoryContext } from '@/contexts/CategoryContext';
import Portal from './Portal';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface MonthlyGroup {
  yearMonth: string;
  label: string;
  expenses: Expense[];
  total: number;
}

export default function SearchModal({ isOpen, onClose }: SearchModalProps) {
  const { getCategoryLabel, getCategoryColor } = useCategoryContext();
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<Expense[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  // 모달 열릴 때 input에 포커스
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // 모달 닫힐 때 상태 초기화
  useEffect(() => {
    if (!isOpen) {
      setKeyword('');
      setResults([]);
      setSelectedExpense(null);
      setExpandedMonth(null);
    }
  }, [isOpen]);

  // 키워드 변경 시 자동 검색 (debounce 적용)
  useEffect(() => {
    // 이전 타이머 취소
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    // 키워드가 비어있으면 결과 초기화
    if (!keyword.trim()) {
      setResults([]);
      setExpandedMonth(null);
      return;
    }

    // 300ms 후 검색 실행
    debounceTimer.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const searchResults = await searchExpenses(keyword);
        setResults(searchResults);
        // 첫 번째 월 자동 펼치기
        if (searchResults.length > 0) {
          const firstMonth = searchResults[0].date.substring(0, 7);
          setExpandedMonth(firstMonth);
        } else {
          setExpandedMonth(null);
        }
      } catch (error) {
        console.error('검색 실패:', error);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [keyword]);

  // 월별 그룹화
  const groupedResults: MonthlyGroup[] = results.reduce((groups, expense) => {
    const yearMonth = expense.date.substring(0, 7); // YYYY-MM
    const existingGroup = groups.find((g) => g.yearMonth === yearMonth);

    if (existingGroup) {
      existingGroup.expenses.push(expense);
      existingGroup.total += expense.amount;
    } else {
      const [year, month] = yearMonth.split('-');
      groups.push({
        yearMonth,
        label: `${year}년 ${parseInt(month)}월`,
        expenses: [expense],
        total: expense.amount,
      });
    }

    return groups;
  }, [] as MonthlyGroup[]);

  // 총 합계
  const totalAmount = results.reduce((sum, e) => sum + e.amount, 0);

  if (!isOpen) return null;

  return (
    <Portal>
      <div
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-[9999] flex items-start justify-center pt-12 md:pt-20 px-4"
        onClick={onClose}
      >
        <div
          className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 검색 헤더 */}
          <div className="p-4 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className="flex-1 relative">
                <input
                  ref={inputRef}
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="가맹점명, 메모로 검색..."
                  className="w-full pl-10 pr-10 py-3 bg-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-800"
                />
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                {/* 키워드 지우기 버튼 */}
                {keyword && (
                  <button
                    onClick={() => setKeyword('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-slate-200 rounded-full transition-colors"
                  >
                    <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              <button
                onClick={onClose}
                className="p-3 hover:bg-slate-100 rounded-xl transition-colors"
              >
                <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* 검색 결과 */}
          <div className="flex-1 overflow-y-auto p-4">
            {isSearching ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
              </div>
            ) : keyword.trim() ? (
              results.length > 0 ? (
                <div className="space-y-4">
                  {/* 검색 요약 */}
                  <div className="bg-blue-50 rounded-xl p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-blue-800 font-medium">
                        &quot;{keyword}&quot; 검색 결과
                      </span>
                      <span className="text-blue-600">
                        {results.length}건 · {totalAmount.toLocaleString()}원
                      </span>
                    </div>
                  </div>

                  {/* 월별 그룹 */}
                  {groupedResults.map((group) => (
                    <div key={group.yearMonth} className="border border-slate-200 rounded-xl overflow-hidden">
                      {/* 월 헤더 (클릭하여 펼치기/접기) */}
                      <button
                        onClick={() => setExpandedMonth(expandedMonth === group.yearMonth ? null : group.yearMonth)}
                        className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <svg
                            className={`w-4 h-4 text-slate-500 transition-transform ${
                              expandedMonth === group.yearMonth ? 'rotate-90' : ''
                            }`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                          <span className="font-semibold text-slate-800">{group.label}</span>
                          <span className="text-sm text-slate-500">{group.expenses.length}건</span>
                        </div>
                        <span className="font-semibold text-slate-800">
                          {group.total.toLocaleString()}원
                        </span>
                      </button>

                      {/* 지출 목록 */}
                      {expandedMonth === group.yearMonth && (
                        <div className="divide-y divide-slate-100">
                          {group.expenses.map((expense) => {
                            const categoryColor = getCategoryColor(expense.category);
                            return (
                              <div
                                key={expense.id}
                                onClick={() => setSelectedExpense(expense)}
                                className="flex items-center justify-between p-3 hover:bg-slate-50 cursor-pointer transition-colors"
                              >
                                <div className="flex items-center gap-3 min-w-0 flex-1">
                                  <div
                                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0"
                                    style={{ backgroundColor: categoryColor }}
                                  >
                                    {getCategoryLabel(expense.category).slice(0, 2)}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="font-medium text-slate-800 truncate">
                                      {expense.merchant}
                                    </div>
                                    <div className="text-xs text-slate-500">
                                      {expense.date}
                                      {expense.memo && ` · ${expense.memo}`}
                                    </div>
                                  </div>
                                </div>
                                <div className="font-semibold text-slate-800 flex-shrink-0 ml-3">
                                  {expense.amount.toLocaleString()}원
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-slate-400">
                  <svg className="w-12 h-12 mx-auto mb-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <p>&quot;{keyword}&quot;에 대한 검색 결과가 없습니다</p>
                </div>
              )
            ) : (
              <div className="text-center py-12 text-slate-400">
                <svg className="w-12 h-12 mx-auto mb-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <p>가맹점명이나 메모를 검색해보세요</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 지출 상세 모달 */}
      {selectedExpense && (
        <div
          className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-[10000] flex items-center justify-center p-4"
          onClick={() => setSelectedExpense(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-800">지출 상세</h3>
              <button
                onClick={() => setSelectedExpense(null)}
                className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              {/* 카테고리 & 가맹점 */}
              <div className="flex items-center gap-3">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center text-white font-medium"
                  style={{ backgroundColor: getCategoryColor(selectedExpense.category) }}
                >
                  {getCategoryLabel(selectedExpense.category).slice(0, 2)}
                </div>
                <div>
                  <div className="text-lg font-semibold text-slate-800">
                    {selectedExpense.merchant}
                  </div>
                  <div className="text-sm text-slate-500">
                    {getCategoryLabel(selectedExpense.category)}
                  </div>
                </div>
              </div>

              {/* 금액 */}
              <div className="bg-slate-50 rounded-xl p-4">
                <div className="text-sm text-slate-500 mb-1">금액</div>
                <div className="text-2xl font-bold text-slate-800">
                  {selectedExpense.amount.toLocaleString()}원
                </div>
              </div>

              {/* 상세 정보 */}
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">날짜</span>
                  <span className="text-slate-800">{selectedExpense.date}</span>
                </div>
                {selectedExpense.time && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">시간</span>
                    <span className="text-slate-800">{selectedExpense.time}</span>
                  </div>
                )}
                {selectedExpense.cardLastFour && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">결제수단</span>
                    <span className="text-slate-800">{selectedExpense.cardLastFour}</span>
                  </div>
                )}
                {selectedExpense.memo && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">메모</span>
                    <span className="text-slate-800">{selectedExpense.memo}</span>
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={() => setSelectedExpense(null)}
              className="w-full mt-6 py-3 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 transition-colors"
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </Portal>
  );
}
