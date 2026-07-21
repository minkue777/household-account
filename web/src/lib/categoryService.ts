import {
  collection,
  onSnapshot,
  query,
  orderBy,
  where,
  db,
} from '@/platform/read-model/firestoreReadModel';
import { CategoryDocument } from '@/types/category';
import { categoryCommands } from '@/features/category-budget/application/categoryCommands';
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
  return categoryCommands.create(householdId, category);
}

// 카테고리 수정
export async function updateCategory(
  id: string,
  data: Partial<Omit<CategoryDocument, 'id' | 'isDefault'>>
): Promise<void> {
  const householdId = requireStoredHouseholdId();
  await categoryCommands.update(householdId, id, data);
}

// 카테고리 삭제 (기본 카테고리는 삭제 불가)
export async function deleteCategory(id: string): Promise<void> {
  const householdId = requireStoredHouseholdId();
  await categoryCommands.archive(householdId, id);
}

// 예산 설정
export async function setBudget(id: string, budget: number | null): Promise<void> {
  const householdId = requireStoredHouseholdId();
  await categoryCommands.setBudget(householdId, id, budget);
}

// 카테고리 순서 변경
export async function reorderCategories(
  categories: { id: string; order: number }[]
): Promise<void> {
  const householdId = requireStoredHouseholdId();
  await categoryCommands.reorder(householdId, categories);
}

// 실시간 구독 (householdId별로)
export function subscribeToCategories(
  householdId: string,
  callback: (categories: CategoryDocument[]) => void
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

  const unsubscribe = onSnapshot(q, (snapshot) => {
    const categories: CategoryDocument[] = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as CategoryDocument[];

    callback(categories);
  }, (error) => {
    // 인덱스 오류 시 링크가 에러 메시지에 포함됨
    callback([]);
  });

  return unsubscribe;
}

// 고유한 카테고리 키 생성
export function generateCategoryKey(): string {
  return `custom_${Date.now()}`;
}

// 사전 정의된 색상 팔레트
export const COLOR_PALETTE = [
  '#4ADE80', // Green
  '#F472B6', // Pink
  '#60A5FA', // Blue
  '#FBBF24', // Amber
  '#9CA3AF', // Gray
  '#A78BFA', // Purple
  '#FB923C', // Orange
  '#2DD4BF', // Teal
  '#F87171', // Red
  '#818CF8', // Indigo
  '#34D399', // Emerald
  '#FACC15', // Yellow
];
