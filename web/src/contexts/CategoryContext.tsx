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
import type { CategoryCatalogReadModel } from '@/lib/categoryService';
import { useHousehold } from '@/contexts/HouseholdContext';

interface CategoryContextType {
  categories: CategoryDocument[];
  catalogVersion: number | null;
  defaultCategoryKey: string;
  isLoading: boolean;
  serverSnapshotReady: boolean;
  readError: unknown;
  // 카테고리 조회 헬퍼
  getCategoryLabel: (key: string) => string;
  getCategoryColor: (key: string) => string;
  getCategoryBudget: (key: string) => number | null;
  // CRUD 작업
  addCategory: (label: string, color: string, budget?: number | null) => Promise<number>;
  updateCategory: (id: string, data: { label?: string; color?: string; budget?: number | null }, expectedVersion: number) => Promise<number>;
  deleteCategory: (id: string, expectedVersion: number) => Promise<number>;
  setBudget: (id: string, budget: number | null, expectedVersion: number) => Promise<number>;
  reorderCategories: (categories: CategoryDocument[], expectedCatalogVersion: number) => Promise<number>;
  setDefaultCategory: (key: string, expectedCatalogVersion: number) => Promise<number>;
  activeCategories: CategoryDocument[];
}

const CategoryContext = createContext<CategoryContextType | undefined>(undefined);

// 알 수 없는 카테고리용 기본값
const UNKNOWN_CATEGORY = {
  label: '알 수 없음',
  color: '#6B7280',
};

const EMPTY_CATEGORIES: CategoryDocument[] = [];

export function CategoryProvider({ children }: { children: React.ReactNode }) {
  const [catalog, setCatalog] = useState<CategoryCatalogReadModel | null>(null);
  const categories = catalog?.categories ?? EMPTY_CATEGORIES;
  const [isLoading, setIsLoading] = useState(true);
  const [serverSnapshotReady, setServerSnapshotReady] = useState(false);
  const [readError, setReadError] = useState<unknown>(null);
  const {
    householdKey,
    isSessionVerified = true,
    remoteReadEpoch = 0,
  } = useHousehold();
  const householdId = householdKey ?? '';

  useLayoutEffect(() => {
    if (!householdId) {
      setCatalog(null);
      setIsLoading(false);
      setServerSnapshotReady(false);
      setReadError(null);
      return;
    }
    setCatalog(null);
    setIsLoading(true);
    setServerSnapshotReady(false);
    setReadError(null);
  }, [householdId]);

  // 초기화 및 실시간 구독
  useEffect(() => {
    setServerSnapshotReady(false);
    if (!householdId) {
      setCatalog(null);
      setIsLoading(false);
      setServerSnapshotReady(false);
      setReadError(null);
      return;
    }
    if (!isSessionVerified) return;

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    void import('@/lib/categoryService')
      .then(({ subscribeToCategoryCatalog }) => {
        if (cancelled) return;
        // 신규 가구의 기본 카테고리는 서버 온보딩 흐름이 별도 멱등 UoW로 생성합니다.
        unsubscribe = subscribeToCategoryCatalog(householdId, (nextCatalog) => {
          if (cancelled) return;
          setCatalog(nextCatalog);
          setIsLoading(false);
          setServerSnapshotReady(true);
          setReadError(null);
        }, (error) => {
          if (cancelled) return;
          setIsLoading(false);
          setServerSnapshotReady(false);
          setReadError(error);
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setIsLoading(false);
        setServerSnapshotReady(false);
        setReadError(error);
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [householdId, isSessionVerified, remoteReadEpoch]);

  // 카테고리 조회 헬퍼
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
    async (label: string, color: string, budget: number | null = null): Promise<number> => {
      if (!householdId) throw new Error('householdId가 설정되지 않았습니다.');
      const key = `custom_${Date.now()}`;
      const order = categories.length;
      const { addCategory: addCategoryService } = await import('@/lib/categoryService');
      return addCategoryService({ key, label, color, budget, order, isActive: true }, householdId);
    },
    [categories.length, householdId]
  );

  const updateCategory = useCallback(
    async (id: string, data: { label?: string; color?: string; budget?: number | null }, expectedVersion: number): Promise<number> => {
      const { updateCategory: updateCategoryService } = await import('@/lib/categoryService');
      return updateCategoryService(id, data, expectedVersion);
    },
    []
  );

  const deleteCategory = useCallback(async (id: string, expectedVersion: number): Promise<number> => {
    const { deleteCategory: deleteCategoryService } = await import('@/lib/categoryService');
    return deleteCategoryService(id, expectedVersion);
  }, []);

  const setBudget = useCallback(async (id: string, budget: number | null, expectedVersion: number): Promise<number> => {
    const { setBudget: setBudgetService } = await import('@/lib/categoryService');
    return setBudgetService(id, budget, expectedVersion);
  }, []);

  const reorderCategories = useCallback(async (reorderedCategories: CategoryDocument[], expectedCatalogVersion: number): Promise<number> => {
    const updates = reorderedCategories.map((cat, index) => ({ id: cat.id, order: index }));
    const { reorderCategories: reorderCategoriesService } = await import('@/lib/categoryService');
    return reorderCategoriesService(updates, expectedCatalogVersion);
  }, []);

  const setDefaultCategory = useCallback(async (key: string, expectedCatalogVersion: number): Promise<number> => {
    if (!householdId) throw new Error('householdId가 설정되지 않았습니다.');
    const { categoryCommands } = await import('@/features/category-budget/application/categoryCommands');
    return categoryCommands.setDefault(householdId, key, expectedCatalogVersion);
  }, [householdId]);

  const activeCategories = useMemo(() => {
    return categories.filter((c) => c.isActive);
  }, [categories]);

  const value: CategoryContextType = {
    categories,
    catalogVersion: catalog?.catalogVersion ?? null,
    defaultCategoryKey: catalog?.defaultCategoryId ?? '',
    isLoading,
    serverSnapshotReady: isSessionVerified && serverSnapshotReady,
    readError,
    getCategoryLabel,
    getCategoryColor,
    getCategoryBudget,
    addCategory,
    updateCategory,
    deleteCategory,
    setBudget,
    reorderCategories,
    activeCategories,
    setDefaultCategory,
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
