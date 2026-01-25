'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useCategoryContext } from '@/contexts/CategoryContext';
import { CategoryDocument } from '@/lib/categoryService';
import ColorPicker from '@/components/ColorPicker';
import { COLOR_PALETTE } from '@/lib/categoryService';
import {
  MerchantRule,
  subscribeToRules,
  updateMerchantRule,
  deleteMerchantRule,
} from '@/lib/merchantRuleService';
import { getStoredHouseholdKey } from '@/lib/householdService';
import { useTheme, THEMES } from '@/contexts/ThemeContext';
import NotificationSettings from '@/components/NotificationSettings';
import { isIOS } from '@/lib/pushNotificationService';

export default function SettingsPage() {
  const {
    categories,
    isLoading,
    addCategory,
    updateCategory,
    deleteCategory,
    reorderCategories,
    activeCategories,
    getCategoryLabel,
    getCategoryColor,
  } = useCategoryContext();

  const { theme, setTheme, themeConfig } = useTheme();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // 드래그 앤 드롭 상태
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // 섹션 펼침/접힘 상태
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const [isRulesOpen, setIsRulesOpen] = useState(false);
  const [isThemeOpen, setIsThemeOpen] = useState(false);

  // 가맹점 규칙 상태
  const [merchantRules, setMerchantRules] = useState<MerchantRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editRuleCategory, setEditRuleCategory] = useState('');

  // iOS 여부
  const [isIOSDevice, setIsIOSDevice] = useState(false);

  useEffect(() => {
    setIsIOSDevice(isIOS());
  }, []);

  // 가맹점 규칙 구독
  useEffect(() => {
    const householdId = getStoredHouseholdKey() || 'guest';
    const unsubscribe = subscribeToRules(householdId, (rules) => {
      setMerchantRules(rules);
      setRulesLoading(false);
    });
    return () => unsubscribe();
  }, []);

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
          <h1 className="text-xl font-bold text-slate-800">설정</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {/* 카테고리 섹션 - 아코디언 */}
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
                          {/* 드래그 핸들 */}
                          <div className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600">
                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-8a2 2 0 1 0-.001-4.001A2 2 0 0 0 13 6zm0 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z" />
                            </svg>
                          </div>
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
          )}
        </div>

        {/* 가맹점 규칙 섹션 - 아코디언 */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <button
            onClick={() => setIsRulesOpen(!isRulesOpen)}
            className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <div className="text-left">
                <div className="font-semibold text-slate-800">가맹점 규칙</div>
                <div className="text-sm text-slate-500">
                  {rulesLoading ? '로딩중...' : `${merchantRules.length}개`}
                </div>
              </div>
            </div>
            <svg
              className={`w-5 h-5 text-slate-400 transition-transform ${isRulesOpen ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {isRulesOpen && (
            <div className="border-t border-slate-100">
              {rulesLoading ? (
                <div className="p-8 text-center text-slate-400">로딩중...</div>
              ) : merchantRules.length === 0 ? (
                <div className="p-8 text-center text-slate-400">
                  저장된 가맹점 규칙이 없습니다.
                  <br />
                  <span className="text-sm">지출 상세에서 카테고리를 변경하면 자동으로 추가됩니다.</span>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {merchantRules.map((rule) => (
                    <div key={rule.id} className="p-4">
                      {editingRuleId === rule.id ? (
                        // 편집 모드
                        <div className="space-y-3">
                          <div className="font-medium text-slate-800">
                            {rule.merchantKeyword}
                          </div>
                          <div className="grid grid-cols-5 gap-2">
                            {activeCategories.map((cat) => (
                              <button
                                key={cat.key}
                                type="button"
                                onClick={() => setEditRuleCategory(cat.key)}
                                className={`flex flex-col items-center p-2 rounded-lg border-2 transition-colors ${
                                  editRuleCategory === cat.key
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
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                setEditingRuleId(null);
                                setEditRuleCategory('');
                              }}
                              className="flex-1 py-2 px-4 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
                            >
                              취소
                            </button>
                            <button
                              onClick={async () => {
                                if (editRuleCategory && editRuleCategory !== rule.category) {
                                  await updateMerchantRule(rule.id, editRuleCategory);
                                }
                                setEditingRuleId(null);
                                setEditRuleCategory('');
                              }}
                              className="flex-1 py-2 px-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
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
                              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium"
                              style={{ backgroundColor: getCategoryColor(rule.category) }}
                            >
                              {getCategoryLabel(rule.category).slice(0, 2)}
                            </div>
                            <div>
                              <div className="font-medium text-slate-800">
                                {rule.merchantKeyword}
                              </div>
                              <div className="text-sm text-slate-500">
                                → {getCategoryLabel(rule.category)}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                setEditingRuleId(rule.id);
                                setEditRuleCategory(rule.category);
                              }}
                              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={async () => {
                                if (confirm(`"${rule.merchantKeyword}" 규칙을 삭제하시겠습니까?`)) {
                                  await deleteMerchantRule(rule.id);
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
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 테마 섹션 - 아코디언 */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <button
            onClick={() => setIsThemeOpen(!isThemeOpen)}
            className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ background: themeConfig.preview }}
              >
                <svg className="w-5 h-5 text-white drop-shadow" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                </svg>
              </div>
              <div className="text-left">
                <div className="font-semibold text-slate-800">테마</div>
                <div className="text-sm text-slate-500">
                  {themeConfig.label}
                </div>
              </div>
            </div>
            <svg
              className={`w-5 h-5 text-slate-400 transition-transform ${isThemeOpen ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {isThemeOpen && (
            <div className="border-t border-slate-100 p-4">
              <div className="grid grid-cols-2 gap-3">
                {THEMES.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTheme(t.key)}
                    className={`p-3 rounded-xl border-2 text-left transition-all ${
                      theme === t.key
                        ? 'border-blue-500 ring-2 ring-blue-200'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div
                      className="w-full h-12 rounded-lg mb-2"
                      style={{ background: t.preview }}
                    />
                    <div className="font-medium text-slate-800 text-sm">{t.label}</div>
                    <div className="text-xs text-slate-500">{t.description}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 알림 설정 섹션 - iOS에서만 표시 */}
        {isIOSDevice && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <NotificationSettings />
          </div>
        )}

        {/* 안내 문구 */}
        <div className="p-4 bg-slate-100 rounded-xl">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-slate-400 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <div className="text-sm text-slate-600">
              <p className="font-medium mb-1">설정 안내</p>
              <ul className="space-y-1 text-slate-500">
                <li>카테고리를 드래그하여 순서를 변경할 수 있습니다.</li>
                <li>기본 카테고리는 삭제할 수 없습니다.</li>
                <li>가맹점 규칙은 지출 상세에서 자동 추가됩니다.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
