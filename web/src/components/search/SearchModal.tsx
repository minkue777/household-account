'use client';

import { useState, useRef, useEffect } from 'react';
import { Expense } from '@/types/expense';
import { searchExpenses } from '@/lib/expenseService';
import Portal from '../Portal';
import SearchResultList from './SearchResultList';
import SearchExpenseEdit from './SearchExpenseEdit';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExpenseUpdate?: (expenseId: string, data: { amount?: number; memo?: string; category?: string; merchant?: string }) => void;
  onDelete?: (expenseId: string) => void;
}

export default function SearchModal({ isOpen, onClose, onExpenseUpdate, onDelete }: SearchModalProps) {
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

  // 검색 결과 새로고침
  const refreshSearch = async () => {
    if (!keyword.trim()) return;
    const searchResults = await searchExpenses(keyword);
    setResults(searchResults);
  };

  // 수정 저장
  const handleSaveEdit = async (updates: { amount?: number; memo?: string; category?: string; merchant?: string }) => {
    if (!selectedExpense || !onExpenseUpdate) return;
    await onExpenseUpdate(selectedExpense.id, updates);
    await refreshSearch();
  };

  // 삭제
  const handleDelete = async (id: string) => {
    if (!onDelete) return;
    await onDelete(id);
    await refreshSearch();
  };

  // 키워드 변경 시 자동 검색 (debounce 적용)
  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    if (!keyword.trim()) {
      setResults([]);
      setExpandedMonth(null);
      return;
    }

    debounceTimer.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const searchResults = await searchExpenses(keyword);
        setResults(searchResults);
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
                  autoFocus
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
            <SearchResultList
              keyword={keyword}
              results={results}
              isSearching={isSearching}
              expandedMonth={expandedMonth}
              onExpandedMonthChange={setExpandedMonth}
              onExpenseClick={setSelectedExpense}
            />
          </div>
        </div>
      </div>

      {/* 지출 수정 모달 */}
      {selectedExpense && (
        <SearchExpenseEdit
          expense={selectedExpense}
          onClose={() => setSelectedExpense(null)}
          onSave={handleSaveEdit}
          onDelete={onDelete ? handleDelete : undefined}
        />
      )}
    </Portal>
  );
}
