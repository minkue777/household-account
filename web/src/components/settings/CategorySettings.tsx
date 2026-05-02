'use client';

import { useState, useEffect } from 'react';
import { useCategoryContext } from '@/contexts/CategoryContext';
import { CategoryDocument } from '@/lib/categoryService';
import { ColorPicker, ConfirmDialog } from '@/components/common';
import { COLOR_PALETTE } from '@/lib/categoryService';
import { getStoredHouseholdKey, getHousehold, setDefaultCategoryKey } from '@/lib/householdService';
import { ChevronDown, Edit2, Plus, Star, Tags, Trash2 } from 'lucide-react';

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
            <Tags className="h-5 w-5 text-blue-600" />
          </div>
          <div className="text-left">
            <div className="font-semibold text-slate-800">카테고리</div>
            <div className="text-sm text-slate-500">{categories.length}개</div>
          </div>
        </div>
        <ChevronDown
          className={`h-5 w-5 text-slate-400 transition-transform ${isCategoryOpen ? 'rotate-180' : ''}`}
        />
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
                        <Star
                          className="h-5 w-5"
                          fill={defaultCategory === category.key ? 'currentColor' : 'none'}
                        />
                      </button>
                      <button
                        onClick={() => handleStartEdit(category)}
                        className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                        aria-label={`${category.label} 수정`}
                        title="수정"
                      >
                        <Edit2 className="h-5 w-5" />
                      </button>
                      <button
                        onClick={() => setPendingDeleteCategory(category)}
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        aria-label={`${category.label} 삭제`}
                        title="삭제"
                      >
                        <Trash2 className="h-5 w-5" />
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
              <Plus className="h-5 w-5" />
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
