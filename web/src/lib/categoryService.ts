import {
  doc,
  onSnapshot,
  db,
} from '@/platform/read-model/firestoreReadModel';
import { CategoryDocument } from '@/types/category';
import { requireClientSessionScope } from '@/composition/clientSessionScope';

export type { CategoryDocument };

function requireStoredHouseholdId(): string {
  return requireClientSessionScope().householdId;
}

// 카테고리 추가
export async function addCategory(
  category: Omit<CategoryDocument, 'id' | 'isDefault' | 'householdId'>,
  householdId: string
): Promise<string> {
  const { categoryCommands } = await import(
    '@/features/category-budget/application/categoryCommands'
  );
  return categoryCommands.create(householdId, category);
}

// 카테고리 수정
export async function updateCategory(
  id: string,
  data: Partial<Omit<CategoryDocument, 'id' | 'isDefault'>>,
  expectedVersion: number
): Promise<void> {
  const householdId = requireStoredHouseholdId();
  const { categoryCommands } = await import(
    '@/features/category-budget/application/categoryCommands'
  );
  await categoryCommands.update(householdId, id, data, expectedVersion);
}

// 카테고리 삭제 (기본 카테고리는 삭제 불가)
export async function deleteCategory(id: string, expectedVersion: number): Promise<void> {
  const householdId = requireStoredHouseholdId();
  const { categoryCommands } = await import(
    '@/features/category-budget/application/categoryCommands'
  );
  await categoryCommands.archive(householdId, id, expectedVersion);
}

// 예산 설정
export async function setBudget(id: string, budget: number | null, expectedVersion: number): Promise<void> {
  const householdId = requireStoredHouseholdId();
  const { categoryCommands } = await import(
    '@/features/category-budget/application/categoryCommands'
  );
  await categoryCommands.setBudget(householdId, id, budget, expectedVersion);
}

// 카테고리 순서 변경
export async function reorderCategories(
  categories: { id: string; order: number }[],
  expectedCatalogVersion: number
): Promise<void> {
  const householdId = requireStoredHouseholdId();
  const { categoryCommands } = await import(
    '@/features/category-budget/application/categoryCommands'
  );
  await categoryCommands.reorder(householdId, categories, expectedCatalogVersion);
}

interface CategoryCatalogReadModel {
  categories: CategoryDocument[];
  catalogVersion: number;
  defaultCategoryId?: string;
}

function readCategoryCatalog(data: Record<string, unknown> | undefined, householdId: string): CategoryCatalogReadModel {
  if (!data) return { categories: [], catalogVersion: 0 };
  if (data.schemaVersion !== 1 || data.householdId !== householdId || !Array.isArray(data.categories)
    || !Number.isSafeInteger(data.catalogVersion) || (data.catalogVersion as number) < 0) {
    throw new Error('카테고리를 불러오지 못했습니다.');
  }
  const ids = new Set<string>();
  const categories = data.categories.map((entry: unknown): CategoryDocument => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('카테고리를 불러오지 못했습니다.');
    const category = entry as Record<string, unknown>;
    if (typeof category.categoryId !== 'string' || !category.categoryId || ids.has(category.categoryId)
      || typeof category.name !== 'string' || typeof category.color !== 'string'
      || !Number.isSafeInteger(category.version) || (category.version as number) < 1
      || !Number.isSafeInteger(category.sortOrder)
      || !(category.budgetInWon === null || Number.isSafeInteger(category.budgetInWon))
      || !['active', 'archive-pending', 'archived'].includes(category.state as string)) {
      throw new Error('카테고리를 불러오지 못했습니다.');
    }
    ids.add(category.categoryId);
    return {
      id: category.categoryId, key: category.categoryId, householdId,
      label: category.name, color: category.color, budget: category.budgetInWon as number | null,
      order: category.sortOrder as number, aggregateVersion: category.version as number,
      isDefault: category.categoryId === data.defaultCategoryId, isActive: category.state === 'active',
    };
  }).sort((left, right) => left.order - right.order || left.key.localeCompare(right.key));
  if (!(data.defaultCategoryId === null || (typeof data.defaultCategoryId === 'string'
    && categories.some(category => category.key === data.defaultCategoryId && category.isActive)))) {
    throw new Error('카테고리를 불러오지 못했습니다.');
  }
  return { categories, catalogVersion: data.catalogVersion as number,
    defaultCategoryId: typeof data.defaultCategoryId === 'string' ? data.defaultCategoryId : undefined };
}

function subscribeToCategoryCatalog(
  householdId: string,
  callback: (catalog: CategoryCatalogReadModel) => void,
  onError?: (error: unknown) => void,
): () => void {
  if (!householdId) { onError?.(new Error('카테고리를 불러오지 못했습니다.')); return () => {}; }
  const reference = doc(db, 'households', householdId, 'categoryCatalog', 'current');
  return onSnapshot(reference, { includeMetadataChanges: true }, snapshot => {
    if (snapshot.metadata.fromCache) return;
    try {
      const catalog = readCategoryCatalog(snapshot.data(), householdId);
      callback(catalog);
    } catch (error) { onError?.(error); }
  }, onError);
}

// 목록과 순서 변경 버전은 동일한 권위 문서에서 읽습니다.
export function subscribeToCategoryCatalogVersion(
  householdId: string,
  callback: (version: number, defaultCategoryKey?: string) => void,
  onError?: (error: unknown) => void,
): () => void {
  return subscribeToCategoryCatalog(householdId,
    catalog => callback(catalog.catalogVersion, catalog.defaultCategoryId), onError);
}

export function subscribeToCategories(
  householdId: string,
  callback: (categories: CategoryDocument[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  if (!householdId) { callback([]); return () => {}; }
  return subscribeToCategoryCatalog(householdId, catalog => callback(catalog.categories), onError);
}

// 고유한 카테고리 키 생성
export function generateCategoryKey(): string {
  return `custom_${Date.now()}`;
}

// 사용 중인 기존 색을 보존하고, 미사용 유사색만 교체한 16색 팔레트입니다.
export const CATEGORY_COLOR_OPTIONS = [
  { value: '#4ADE80', label: '초록' },
  { value: '#F472B6', label: '분홍' },
  { value: '#60A5FA', label: '하늘' },
  { value: '#FBBF24', label: '황금색' },
  { value: '#9CA3AF', label: '회색' },
  { value: '#A78BFA', label: '보라' },
  { value: '#2563EB', label: '파랑' },
  { value: '#2DD4BF', label: '청록' },
  { value: '#F87171', label: '빨강' },
  { value: '#818CF8', label: '연남색' },
  { value: '#34D399', label: '민트' },
  { value: '#DC2626', label: '진빨강' },
  { value: '#FDBA74', label: '살구' },
  { value: '#BEF264', label: '연두' },
  { value: '#67E8F9', label: '밝은 청록' },
  { value: '#CBAA91', label: '베이지' },
];

export const COLOR_PALETTE = CATEGORY_COLOR_OPTIONS.map(({ value }) => value);
