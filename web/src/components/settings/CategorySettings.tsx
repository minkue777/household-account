'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useCategoryContext } from '@/contexts/CategoryContext';
import { CategoryDocument } from '@/lib/categoryService';
import ColorPicker from '@/components/common/ColorPicker';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import { COLOR_PALETTE, subscribeToCategoryCatalogVersion } from '@/lib/categoryService';
import { setDefaultCategoryKey } from '@/lib/householdService';
import { useHousehold } from '@/contexts/HouseholdContext';
import { useAppDialog } from '@/contexts/AppDialogContext';
import { ChevronDown, Edit2, Plus, Star, Tags, Trash2 } from 'lucide-react';
import { useCategoryReorder } from './useCategoryReorder';

type CategoryMutation = 'add' | 'edit' | 'delete' | 'default' | 'reorder';

export default function CategorySettings() {
  const { household, isSessionVerified = true, remoteReadEpoch = 0 } = useHousehold();
  const { showAlert } = useAppDialog();
  const {
    activeCategories: categories,
    addCategory,
    updateCategory,
    deleteCategory,
    reorderCategories,
  } = useCategoryContext();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingVersion, setEditingVersion] = useState(1);
  const [showAddForm, setShowAddForm] = useState(false);
  const [pendingDeleteCategory, setPendingDeleteCategory] = useState<CategoryDocument | null>(null);

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
  const mutationInFlightRef = useRef(false);
  const [pendingMutation, setPendingMutation] = useState<CategoryMutation | null>(null);
  const [catalogVersion, setCatalogVersion] = useState<number | null>(null);
  const [completedMutationVersion, setCompletedMutationVersion] = useState<number | null>(null);
  const [catalogReadFailed, setCatalogReadFailed] = useState(false);
  const isCatalogReady = catalogVersion !== null
    && (completedMutationVersion === null || catalogVersion > completedMutationVersion);
  const isMutating = pendingMutation !== null || !isCatalogReady;

  useEffect(() => {
    setCatalogVersion(null);
    setCompletedMutationVersion(null);
    setCatalogReadFailed(false);
    if (!isCategoryOpen || !household?.id || !isSessionVerified) return;
    return subscribeToCategoryCatalogVersion(household.id, (version, defaultCategoryKey) => {
      setCatalogVersion(version);
      if (defaultCategoryKey !== undefined) setDefaultCategory(defaultCategoryKey);
    }, () => {
      setCatalogVersion(null);
      setCatalogReadFailed(true);
    });
  }, [isCategoryOpen, household?.id, isSessionVerified, remoteReadEpoch]);

  useEffect(() => {
    setDefaultCategory(household?.defaultCategoryKey ?? '');
  }, [household?.defaultCategoryKey]);

  const runMutation = useCallback(async (
    mutation: CategoryMutation,
    operation: () => Promise<unknown>,
    failureMessage: string
  ): Promise<boolean> => {
    if (mutationInFlightRef.current || !isCatalogReady) return false;

    mutationInFlightRef.current = true;
    setPendingMutation(mutation);
    try {
      await operation();
      // 명령 응답이 구독보다 먼저 와도 다음 변경에 이전 버전을 재사용하지 않습니다.
      // archive는 준비와 완료 트랜잭션에서 각각 버전이 증가합니다.
      setCompletedMutationVersion(catalogVersion! + (mutation === 'delete' ? 1 : 0));
      return true;
    } catch (error) {
      console.error(`${failureMessage}:`, error);
      void showAlert(failureMessage, '카테고리 변경 실패');
      return false;
    } finally {
      mutationInFlightRef.current = false;
      setPendingMutation(null);
    }
  }, [showAlert, isCatalogReady, catalogVersion]);

  const handleAddCategory = async () => {
    const label = newLabel.trim();
    if (!label || mutationInFlightRef.current) return;

    const budget = newBudget ? parseInt(newBudget, 10) : null;
    const completed = await runMutation(
      'add',
      () => addCategory(label, newColor, budget),
      '카테고리를 추가하지 못했습니다. 다시 시도해 주세요.'
    );
    if (!completed) return;

    // 폼 초기화
    setNewLabel('');
    setNewColor(COLOR_PALETTE[0]);
    setNewBudget('');
    setShowAddForm(false);
  };

  const handleStartEdit = (category: CategoryDocument) => {
    if (mutationInFlightRef.current) return;
    setEditingId(category.id);
    setEditingVersion(category.aggregateVersion ?? 1);
    setEditLabel(category.label);
    setEditColor(category.color);
    setEditBudget(category.budget?.toString() || '');
  };

  const handleSaveEdit = async () => {
    const categoryId = editingId;
    const label = editLabel.trim();
    if (!categoryId || !label || mutationInFlightRef.current) return;

    const budget = editBudget ? parseInt(editBudget, 10) : null;
    const completed = await runMutation(
      'edit',
      () => updateCategory(categoryId, {
        label,
        color: editColor,
        budget,
      }, editingVersion),
      '카테고리를 수정하지 못했습니다. 다시 시도해 주세요.'
    );
    if (!completed) return;

    setEditingId(null);
  };

  const handleCancelEdit = () => {
    if (mutationInFlightRef.current) return;
    setEditingId(null);
    setEditLabel('');
    setEditColor('');
    setEditBudget('');
  };

  const handleDelete = async () => {
    const category = pendingDeleteCategory;
    if (!category || mutationInFlightRef.current) return;

    const completed = await runMutation(
      'delete',
      () => deleteCategory(category.id, category.aggregateVersion ?? 1),
      '카테고리를 삭제하지 못했습니다. 다시 시도해 주세요.'
    );
    if (!completed) return;
    setPendingDeleteCategory(null);
  };

  // 기본 카테고리 변경
  const handleDefaultCategoryChange = async (categoryKey: string) => {
    if (mutationInFlightRef.current || catalogVersion === null || categoryKey === defaultCategory) return;
    const completed = await runMutation(
      'default',
      async () => {
        if (!household?.id) throw new Error('인증된 가구 세션이 필요합니다.');
        await setDefaultCategoryKey(household.id, categoryKey, catalogVersion);
      },
      '기본 카테고리를 변경하지 못했습니다. 다시 시도해 주세요.'
    );
    if (!completed) return;
    setDefaultCategory(categoryKey);
  };

  const reorder = useCategoryReorder(
    categories,
    isMutating || catalogVersion === null || editingId !== null || !isCategoryOpen,
    async (reordered) => {
      if (catalogVersion === null) return;
      await runMutation(
        'reorder',
        () => reorderCategories(reordered, catalogVersion),
        '카테고리 순서를 변경하지 못했습니다. 다시 시도해 주세요.'
      );
    }
  );

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200">
      <button
        onClick={() => setIsCategoryOpen(!isCategoryOpen)}
        className={`w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors ${isCategoryOpen ? 'rounded-t-2xl' : 'rounded-2xl'}`}
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
          <p id="category-reorder-help" className="px-4 pt-3 text-xs text-slate-500">
            왼쪽 동그라미를 위아래로 끌어 순서를 바꾸세요.
          </p>
          {catalogReadFailed && (
            <p role="alert" className="px-4 pt-2 text-sm text-red-600">카테고리 정보를 불러오지 못했습니다.</p>
          )}
          <div ref={reorder.listRef} data-testid="category-order-list" className="divide-y divide-slate-100">
            {categories.map((category) => (
              <div
                key={category.id}
                data-category-id={category.id}
                style={reorder.preview?.id === category.id
                  ? { transform: `translateY(${reorder.preview.offsetY}px)` }
                  : undefined}
                className={`relative p-4 ${
                  reorder.preview?.id === category.id
                    ? 'z-10 bg-white shadow-lg ring-2 ring-blue-300'
                    : reorder.preview?.targetId === category.id
                      ? 'bg-blue-50 ring-2 ring-inset ring-blue-300'
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
                        className="min-w-0 flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                        disabled={isMutating}
                        className="flex-1 py-2 px-4 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
                      >
                        취소
                      </button>
                      <button
                        onClick={handleSaveEdit}
                        disabled={isMutating || !editLabel.trim()}
                        className="flex-1 py-2 px-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:bg-slate-300"
                      >
                        {pendingMutation === 'edit' ? '저장 중..' : '저장'}
                      </button>
                    </div>
                  </div>
                ) : (
                  // 보기 모드
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1 flex items-center gap-3">
                      <button
                        type="button"
                        aria-label={`${category.label} 순서 이동`}
                        aria-describedby="category-reorder-help"
                        disabled={isMutating || catalogVersion === null || editingId !== null}
                        onPointerDown={(event) => reorder.onPointerDown(event, category.id)}
                        onPointerMove={reorder.onPointerMove}
                        onPointerUp={reorder.onPointerUp}
                        onPointerCancel={reorder.cancel}
                        onLostPointerCapture={reorder.cancel}
                        onKeyDown={(event) => {
                          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                            event.preventDefault();
                            reorder.moveByKeyboard(category.id, event.key === 'ArrowUp' ? -1 : 1);
                          }
                        }}
                        className="w-10 h-10 shrink-0 touch-none select-none cursor-grab active:cursor-grabbing rounded-full flex items-center justify-center text-white text-sm font-medium disabled:opacity-50"
                        style={{ backgroundColor: category.color }}
                      >
                        {category.label.slice(0, 2)}
                      </button>
                      <div className="min-w-0">
                        <div className="font-medium text-slate-800 flex flex-wrap items-center gap-2 break-all">
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
                    <div className="shrink-0 flex items-center gap-1">
                      {/* 기본 카테고리 설정 버튼 */}
                      <button
                        onClick={() => {
                          void handleDefaultCategoryChange(category.key);
                        }}
                        disabled={isMutating || catalogVersion === null}
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
                        disabled={isMutating}
                        className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                        aria-label={`${category.label} 수정`}
                        title="수정"
                      >
                        <Edit2 className="h-5 w-5" />
                      </button>
                      <button
                        onClick={() => {
                          if (!mutationInFlightRef.current) setPendingDeleteCategory(category);
                        }}
                        disabled={isMutating}
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
            <div className="p-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <ColorPicker value={newColor} onChange={setNewColor} />
                  <input
                    type="text"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder="카테고리명"
                    className="min-w-0 flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                      if (mutationInFlightRef.current) return;
                      setShowAddForm(false);
                      setNewLabel('');
                      setNewColor(COLOR_PALETTE[0]);
                      setNewBudget('');
                    }}
                    disabled={isMutating}
                    className="flex-1 py-2 px-4 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    취소
                  </button>
                  <button
                    onClick={() => {
                      void handleAddCategory();
                    }}
                    disabled={isMutating || !newLabel.trim()}
                    className="flex-1 py-2 px-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:bg-slate-300"
                  >
                    {pendingMutation === 'add' ? '추가 중..' : '추가'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button
              onClick={() => {
                if (!mutationInFlightRef.current) setShowAddForm(true);
              }}
              disabled={isMutating}
              className="w-full p-4 border-t border-slate-200 flex items-center justify-center gap-2 text-blue-500 hover:bg-blue-50 transition-colors rounded-b-2xl"
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
