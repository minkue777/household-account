'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
  useMemo,
} from 'react';
import type { CategoryDocument } from '@/types/category';
import { useHousehold } from '@/contexts/HouseholdContext';
import {
  readCategorySnapshot,
  writeCategorySnapshot,
} from '@/features/category-budget/application/categorySnapshot';

interface CategoryContextType {
  categories: CategoryDocument[];
  isLoading: boolean;
  // 카테고리 조회 헬퍼
  getCategoryByKey: (key: string) => CategoryDocument | undefined;
  getCategoryLabel: (key: string) => string;
  getCategoryColor: (key: string) => string;
  getCategoryBudget: (key: string) => number | null;
  // CRUD 작업
  addCategory: (label: string, color: string, budget?: number | null) => Promise<string>;
  updateCategory: (id: string, data: { label?: string; color?: string; budget?: number | null }) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  setBudget: (id: string, budget: number | null) => Promise<void>;
  reorderCategories: (categories: CategoryDocument[]) => Promise<void>;
  // 호환성 헬퍼 (기존 CATEGORY_LABELS, CATEGORY_COLORS 대체)
  categoryLabels: Record<string, string>;
  categoryColors: Record<string, string>;
  activeCategories: CategoryDocument[];
}

const CategoryContext = createContext<CategoryContextType | undefined>(undefined);

// 알 수 없는 카테고리용 기본값
const UNKNOWN_CATEGORY = {
  label: '알 수 없음',
  color: '#6B7280',
};

export function CategoryProvider({ children }: { children: React.ReactNode }) {
  const [categories, setCategories] = useState<CategoryDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { householdKey, isSessionVerified = true } = useHousehold();
  const householdId = householdKey ?? '';

  useLayoutEffect(() => {
    if (!householdId) {
      setCategories([]);
      setIsLoading(false);
      return;
    }
    const cached = readCategorySnapshot(householdId);
    setCategories(cached ?? []);
    setIsLoading(cached === undefined);
  }, [householdId]);

  // 초기화 및 실시간 구독
  useEffect(() => {
    if (!householdId) {
      setCategories([]);
      setIsLoading(false);
      return;
    }
    if (!isSessionVerified) return;

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    void import('@/lib/categoryService')
      .then(({ subscribeToCategories }) => {
        if (cancelled) return;
        // 기본 카테고리는 HouseholdCreated 이벤트를 소비한 서버가 생성합니다.
        unsubscribe = subscribeToCategories(householdId, (cats) => {
          writeCategorySnapshot(householdId, cats);
          setCategories(cats);
          setIsLoading(false);
        }, () => setIsLoading(false));
      })
      .catch(() => {
        if (cancelled) return;
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [householdId, isSessionVerified]);

  // 카테고리 조회 헬퍼
  const getCategoryByKey = useCallback(
    (key: string): CategoryDocument | undefined => {
      return categories.find((c) => c.key === key);
    },
    [categories]
  );

  const getCategoryLabel = useCallback(
    (key: string): string => {
      const category = categories.find((c) => c.key === key);
      return category?.label ?? UNKNOWN_CATEGORY.label;
    },
    [categories]
  );

  const getCategoryColor = useCallback(
    (key: string): string => {
      const category = categories.find((c) => c.key === key);
      return category?.color ?? UNKNOWN_CATEGORY.color;
    },
    [categories]
  );

  const getCategoryBudget = useCallback(
    (key: string): number | null => {
      const category = categories.find((c) => c.key === key);
      return category?.budget ?? null;
    },
    [categories]
  );

  // CRUD 작업
  const addCategory = useCallback(
    async (label: string, color: string, budget: number | null = null): Promise<string> => {
      if (!householdId) throw new Error('householdId가 설정되지 않았습니다.');
      const key = `custom_${Date.now()}`;
      const order = categories.length;
      const { addCategory: addCategoryService } = await import('@/lib/categoryService');
      return addCategoryService({ key, label, color, budget, order, isActive: true }, householdId);
    },
    [categories.length, householdId]
  );

  const updateCategory = useCallback(
    async (id: string, data: { label?: string; color?: string; budget?: number | null }): Promise<void> => {
      const { updateCategory: updateCategoryService } = await import('@/lib/categoryService');
      await updateCategoryService(id, data);
    },
    []
  );

  const deleteCategory = useCallback(async (id: string): Promise<void> => {
    const { deleteCategory: deleteCategoryService } = await import('@/lib/categoryService');
    await deleteCategoryService(id);
  }, []);

  const setBudget = useCallback(async (id: string, budget: number | null): Promise<void> => {
    const { setBudget: setBudgetService } = await import('@/lib/categoryService');
    await setBudgetService(id, budget);
  }, []);

  const reorderCategories = useCallback(async (reorderedCategories: CategoryDocument[]): Promise<void> => {
    const updates = reorderedCategories.map((cat, index) => ({ id: cat.id, order: index }));
    const { reorderCategories: reorderCategoriesService } = await import('@/lib/categoryService');
    await reorderCategoriesService(updates);
  }, []);

  // 호환성 헬퍼 (기존 코드와의 호환성을 위해)
  const categoryLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const cat of categories) {
      labels[cat.key] = cat.label;
    }
    return labels;
  }, [categories]);

  const categoryColors = useMemo(() => {
    const colors: Record<string, string> = {};
    for (const cat of categories) {
      colors[cat.key] = cat.color;
    }
    return colors;
  }, [categories]);

  const activeCategories = useMemo(() => {
    return categories.filter((c) => c.isActive);
  }, [categories]);

  const value: CategoryContextType = {
    categories,
    isLoading,
    getCategoryByKey,
    getCategoryLabel,
    getCategoryColor,
    getCategoryBudget,
    addCategory,
    updateCategory,
    deleteCategory,
    setBudget,
    reorderCategories,
    categoryLabels,
    categoryColors,
    activeCategories,
  };

  return <CategoryContext.Provider value={value}>{children}</CategoryContext.Provider>;
}

export function useCategoryContext(): CategoryContextType {
  const context = useContext(CategoryContext);
  if (context === undefined) {
    throw new Error('useCategoryContext must be used within a CategoryProvider');
  }
  return context;
}
