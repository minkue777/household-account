'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useCategoryContext } from '@/contexts/CategoryContext';
import { CategoryDocument } from '@/lib/categoryService';
import ColorPicker from '@/components/ColorPicker';
import { COLOR_PALETTE } from '@/lib/categoryService';

export default function SettingsPage() {
  const {
    categories,
    isLoading,
    addCategory,
    updateCategory,
    deleteCategory,
  } = useCategoryContext();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // 새 카테고리 폼 상태
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState(COLOR_PALETTE[0]);
  const [newBudget, setNewBudget] = useState('');

  // 편집 폼 상태
  const [editLabel, setEditLabel] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editBudget, setEditBudget] = useState('');

  const handleAddCategory = async () => {
    if (!newLabel.trim()) return;

    const budget = newBudget ? parseInt(newBudget, 10) : null;
    await addCategory(newLabel.trim(), newColor, budget);

    // 폼 초기화
    setNewLabel('');
    setNewColor(COLOR_PALETTE[0]);
    setNewBudget('');
    setShowAddForm(false);
  };

  const handleStartEdit = (category: CategoryDocument) => {
    setEditingId(category.id);
    setEditLabel(category.label);
    setEditColor(category.color);
    setEditBudget(category.budget?.toString() || '');
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editLabel.trim()) return;

    const budget = editBudget ? parseInt(editBudget, 10) : null;
    await updateCategory(editingId, {
      label: editLabel.trim(),
      color: editColor,
      budget,
    });

    setEditingId(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditLabel('');
    setEditColor('');
    setEditBudget('');
  };

  const handleDelete = async (id: string) => {
    if (confirm('이 카테고리를 삭제하시겠습니까?\n기존 지출 데이터는 유지되며 "알 수 없음"으로 표시됩니다.')) {
      await deleteCategory(id);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-slate-400">로딩중...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* 헤더 */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link
            href="/"
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-xl font-bold text-slate-800">카테고리 설정</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* 카테고리 목록 */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="divide-y divide-slate-100">
            {categories.map((category) => (
              <div key={category.id} className="p-4">
                {editingId === category.id ? (
                  // 편집 모드
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <ColorPicker value={editColor} onChange={setEditColor} />
                      <input
                        type="text"
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        placeholder="카테고리명"
                        className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-slate-500 mb-1">
                        월 예산 (선택사항)
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          value={editBudget}
                          onChange={(e) => setEditBudget(e.target.value)}
                          placeholder="예산 없음"
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 pr-10"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                          원
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleCancelEdit}
                        className="flex-1 py-2 px-4 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
                      >
                        취소
                      </button>
                      <button
                        onClick={handleSaveEdit}
                        disabled={!editLabel.trim()}
                        className="flex-1 py-2 px-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:bg-slate-300"
                      >
                        저장
                      </button>
                    </div>
                  </div>
                ) : (
                  // 보기 모드
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-medium"
                        style={{ backgroundColor: category.color }}
                      >
                        {category.label.slice(0, 2)}
                      </div>
                      <div>
                        <div className="font-medium text-slate-800">
                          {category.label}
                          {category.isDefault && (
                            <span className="ml-2 text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                              기본
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-slate-500">
                          {category.budget
                            ? `월 예산: ${category.budget.toLocaleString()}원`
                            : '예산 미설정'}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleStartEdit(category)}
                        className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      {!category.isDefault && (
                        <button
                          onClick={() => handleDelete(category.id)}
                          className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 새 카테고리 추가 */}
          {showAddForm ? (
            <div className="p-4 border-t border-slate-200 bg-slate-50">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <ColorPicker value={newColor} onChange={setNewColor} />
                  <input
                    type="text"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder="카테고리명"
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-500 mb-1">
                    월 예산 (선택사항)
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      value={newBudget}
                      onChange={(e) => setNewBudget(e.target.value)}
                      placeholder="예산 없음"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 pr-10"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                      원
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setShowAddForm(false);
                      setNewLabel('');
                      setNewColor(COLOR_PALETTE[0]);
                      setNewBudget('');
                    }}
                    className="flex-1 py-2 px-4 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    취소
                  </button>
                  <button
                    onClick={handleAddCategory}
                    disabled={!newLabel.trim()}
                    className="flex-1 py-2 px-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:bg-slate-300"
                  >
                    추가
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowAddForm(true)}
              className="w-full p-4 border-t border-slate-200 flex items-center justify-center gap-2 text-blue-500 hover:bg-blue-50 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="font-medium">새 카테고리 추가</span>
            </button>
          )}
        </div>

        {/* 안내 문구 */}
        <div className="mt-6 p-4 bg-slate-100 rounded-xl">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-slate-400 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <div className="text-sm text-slate-600">
              <p className="font-medium mb-1">카테고리 관리 안내</p>
              <ul className="space-y-1 text-slate-500">
                <li>기본 카테고리(생활비, 육아비 등)는 삭제할 수 없습니다.</li>
                <li>카테고리를 삭제해도 기존 지출 데이터는 유지됩니다.</li>
                <li>월 예산을 설정하면 홈 화면에서 사용량을 확인할 수 있습니다.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
