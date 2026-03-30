'use client';

import { useState, useEffect } from 'react';
import { useCategoryContext } from '@/contexts/CategoryContext';
import { CategoryDocument } from '@/lib/categoryService';
import { ColorPicker, ConfirmDialog } from '@/components/common';
import { COLOR_PALETTE } from '@/lib/categoryService';
import { getStoredHouseholdKey, getHousehold, setDefaultCategoryKey } from '@/lib/householdService';

export default function CategorySettings() {
  const {
    categories,
    addCategory,
    updateCategory,
    deleteCategory,
    reorderCategories,
  } = useCategoryContext();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [pendingDeleteCategory, setPendingDeleteCategory] = useState<CategoryDocument | null>(null);

  // 드래그 앤 드롭 상태
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // 섹션 펼침/접힘 상태
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);

  // 기본 카테고리 설정
  const [defaultCategory, setDefaultCategory] = useState<string>('');

  // 새 카테고리 폼 상태
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState(COLOR_PALETTE[0]);
  const [newBudget, setNewBudget] = useState('');

  // 편집 폼 상태
  const [editLabel, setEditLabel] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editBudget, setEditBudget] = useState('');

  // household 설정 로드
  useEffect(() => {
    const householdId = getStoredHouseholdKey() || 'guest';
    getHousehold(householdId).then((household) => {
      if (household?.defaultCategoryKey) {
        setDefaultCategory(household.defaultCategoryKey);
      }
    });
  }, []);

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

  const handleDelete = async () => {
    if (!pendingDeleteCategory) return;

    await deleteCategory(pendingDeleteCategory.id);
    setPendingDeleteCategory(null);
  };

  // 기본 카테고리 변경
  const handleDefaultCategoryChange = async (categoryKey: string) => {
    const householdId = getStoredHouseholdKey() || 'guest';
    await setDefaultCategoryKey(householdId, categoryKey);
    setDefaultCategory(categoryKey);
  };

  // 드래그 앤 드롭 핸들러
  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (draggedId && draggedId !== id) {
      setDragOverId(id);
    }
  };

  const handleDragLeave = () => {
    setDragOverId(null);
  };

  const handleDrop = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }

    const draggedIndex = categories.findIndex((c) => c.id === draggedId);
    const targetIndex = categories.findIndex((c) => c.id === targetId);

    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }

    // 새 순서 배열 생성
    const reordered = [...categories];
    const [removed] = reordered.splice(draggedIndex, 1);
    reordered.splice(targetIndex, 0, removed);

    await reorderCategories(reordered);

    setDraggedId(null);
    setDragOverId(null);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <button
        onClick={() => setIsCategoryOpen(!isCategoryOpen)}
        className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
          </div>
          <div className="text-left">
            <div className="font-semibold text-slate-800">카테고리</div>
            <div className="text-sm text-slate-500">{categories.length}개</div>
          </div>
        </div>
        <svg
          className={`w-5 h-5 text-slate-400 transition-transform ${isCategoryOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isCategoryOpen && (
        <div className="border-t border-slate-100">
          <div className="divide-y divide-slate-100">
            {categories.map((category) => (
              <div
                key={category.id}
                draggable={editingId !== category.id}
                onDragStart={(e) => handleDragStart(e, category.id)}
                onDragOver={(e) => handleDragOver(e, category.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, category.id)}
                onDragEnd={handleDragEnd}
                className={`p-4 transition-all ${
                  draggedId === category.id
                    ? 'opacity-50 bg-slate-100'
                    : dragOverId === category.id
                      ? 'bg-blue-50 border-l-4 border-blue-500'
                      : ''
                }`}
              >
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
                        <div className="font-medium text-slate-800 flex items-center gap-2">
                          {category.label}
                          {defaultCategory === category.key && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-600">
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
                    <div className="flex items-center gap-1">
                      {/* 기본 카테고리 설정 버튼 */}
                      <button
                        onClick={() => handleDefaultCategoryChange(category.key)}
                        className={`p-2 rounded-lg transition-colors ${
                          defaultCategory === category.key
                            ? 'text-blue-500 bg-blue-50'
                            : 'text-slate-400 hover:text-blue-500 hover:bg-blue-50'
                        }`}
                        title="기본 카테고리로 설정"
                      >
                        <svg className="w-5 h-5" fill={defaultCategory === category.key ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleStartEdit(category)}
                        className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => setPendingDeleteCategory(category)}
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
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
      )}

      <ConfirmDialog
        isOpen={!!pendingDeleteCategory}
        title="카테고리 삭제"
        message={
          pendingDeleteCategory
            ? `"${pendingDeleteCategory.label}" 카테고리를 삭제하시겠습니까? 기존 지출 데이터는 유지되며 "알 수 없음"으로 표시됩니다.`
            : ''
        }
        confirmLabel="삭제"
        cancelLabel="취소"
        variant="danger"
        onConfirm={() => {
          void handleDelete();
        }}
        onCancel={() => setPendingDeleteCategory(null)}
      />
    </div>
  );
}
