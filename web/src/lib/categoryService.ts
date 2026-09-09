import {
  collection,
  doc,
  onSnapshot,
  query,
  orderBy,
  where,
  db,
} from '@/platform/read-model/firestoreReadModel';
import { CategoryDocument } from '@/types/category';
import { requireClientSessionScope } from '@/composition/clientSessionScope';

export type { CategoryDocument };

const COLLECTION_NAME = 'categories';

function requireStoredHouseholdId(): string {
  return requireClientSessionScope().householdId;
}

// 컬렉션 참조
const categoriesRef = collection(db, COLLECTION_NAME);

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

// 순서/기본 카테고리 변경에 사용하는 버전은 개별 카테고리 버전과 별도로 구독합니다.
export function subscribeToCategoryCatalogVersion(
  householdId: string,
  callback: (version: number, defaultCategoryKey?: string) => void,
  onError?: (error: unknown) => void
): () => void {
  if (!householdId) {
    onError?.(new Error('카테고리 버전을 불러오지 못했습니다.'));
    return () => {};
  }

  const reference = doc(db, 'households', householdId, 'categorySettings', 'default');
  return onSnapshot(reference, { includeMetadataChanges: true }, (snapshot) => {
    if (snapshot.metadata.fromCache) return;
    const data = snapshot.data();
    // 서버 저장소도 설정 문서가 없는 legacy 카탈로그의 버전을 0으로 취급합니다.
    const version = data?.catalogVersion ?? data?.aggregateVersion ?? 0;
    if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) {
      onError?.(new Error('카테고리 버전을 불러오지 못했습니다.'));
      return;
    }
    callback(version, typeof data?.defaultCategoryId === 'string' ? data.defaultCategoryId : undefined);
  }, onError);
}

// 실시간 구독 (householdId별로)
export function subscribeToCategories(
  householdId: string,
  callback: (categories: CategoryDocument[]) => void,
  onError?: (error: unknown) => void
): () => void {
  if (!householdId) {
    callback([]);
    return () => {};
  }

  const q = query(
    categoriesRef,
    where('householdId', '==', householdId),
    orderBy('order', 'asc')
  );

  let hasServerSnapshot = false;
  const unsubscribe = onSnapshot(q, { includeMetadataChanges: true }, (snapshot) => {
    if (!hasServerSnapshot && snapshot.metadata.fromCache) return;
    hasServerSnapshot = true;
    const categories: CategoryDocument[] = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as CategoryDocument[];

    callback(categories);
  }, (error) => {
    // 일시 오류가 마지막으로 확인한 카테고리 화면을 지우지 않도록 유지합니다.
    onError?.(error);
  });

  return unsubscribe;
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
