import {
  collection,
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

// 색조와 밝기 차이를 함께 둔 카테고리 선택 색상입니다.
export const CATEGORY_COLOR_OPTIONS = [
  { value: '#16A34A', label: '초록' },
  { value: '#DC2626', label: '빨강' },
  { value: '#F97316', label: '주황' },
  { value: '#FACC15', label: '노랑' },
  { value: '#84CC16', label: '연두' },
  { value: '#5EEAD4', label: '민트' },
  { value: '#0F766E', label: '청록' },
  { value: '#38BDF8', label: '하늘' },
  { value: '#2563EB', label: '파랑' },
  { value: '#1E3A8A', label: '남색' },
  { value: '#9333EA', label: '보라' },
  { value: '#C4B5FD', label: '연보라' },
  { value: '#EC4899', label: '분홍' },
  { value: '#831843', label: '자주' },
  { value: '#92400E', label: '갈색' },
  { value: '#64748B', label: '회색' },
];

export const COLOR_PALETTE = CATEGORY_COLOR_OPTIONS.map(({ value }) => value);
