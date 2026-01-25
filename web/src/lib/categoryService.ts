import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  getDocs,
  writeBatch,
  where,
} from 'firebase/firestore';
import { db } from './firebase';

export interface CategoryDocument {
  id: string;
  key: string;           // 'living', 'custom_001' 등
  label: string;         // '생활비', '취미' 등
  color: string;         // '#4ADE80'
  budget: number | null; // 월 예산 (null이면 무제한)
  order: number;         // 정렬 순서
  isDefault: boolean;    // 기본 카테고리 (삭제 불가)
  isActive: boolean;     // 활성화 여부
  householdId: string;   // 가구 ID
}

// 기본 카테고리 정의 (householdId는 동적으로 추가)
const DEFAULT_CATEGORIES: Omit<CategoryDocument, 'id' | 'householdId'>[] = [
  { key: 'living', label: '생활비', color: '#4ADE80', budget: null, order: 0, isDefault: true, isActive: true },
  { key: 'childcare', label: '육아비', color: '#F472B6', budget: null, order: 1, isDefault: true, isActive: true },
  { key: 'fixed', label: '고정비', color: '#60A5FA', budget: null, order: 2, isDefault: true, isActive: true },
  { key: 'food', label: '식비', color: '#FBBF24', budget: null, order: 3, isDefault: true, isActive: true },
  { key: 'etc', label: '기타', color: '#9CA3AF', budget: null, order: 4, isDefault: true, isActive: true },
];

const COLLECTION_NAME = 'categories';

// 컬렉션 참조
const categoriesRef = collection(db, COLLECTION_NAME);

// 기본 카테고리 초기화 (첫 실행 시, householdId별로)
export async function initializeDefaultCategories(householdId: string): Promise<void> {
  if (!householdId) return;

  const q = query(categoriesRef, where('householdId', '==', householdId));
  const snapshot = await getDocs(q);

  if (snapshot.empty) {
    const batch = writeBatch(db);

    for (const category of DEFAULT_CATEGORIES) {
      const docRef = doc(categoriesRef);
      batch.set(docRef, { ...category, householdId });
    }

    await batch.commit();
    console.log(`기본 카테고리가 초기화되었습니다. (householdId: ${householdId})`);
  }
}

// 카테고리 추가
export async function addCategory(
  category: Omit<CategoryDocument, 'id' | 'isDefault' | 'householdId'>,
  householdId: string
): Promise<string> {
  const docRef = await addDoc(categoriesRef, {
    ...category,
    householdId,
    isDefault: false,
  });
  return docRef.id;
}

// 카테고리 수정
export async function updateCategory(
  id: string,
  data: Partial<Omit<CategoryDocument, 'id' | 'isDefault'>>
): Promise<void> {
  const docRef = doc(db, COLLECTION_NAME, id);
  await updateDoc(docRef, data);
}

// 카테고리 삭제 (기본 카테고리는 삭제 불가)
export async function deleteCategory(id: string): Promise<void> {
  const docRef = doc(db, COLLECTION_NAME, id);
  await deleteDoc(docRef);
}

// 예산 설정
export async function setBudget(id: string, budget: number | null): Promise<void> {
  await updateCategory(id, { budget });
}

// 카테고리 순서 변경
export async function reorderCategories(
  categories: { id: string; order: number }[]
): Promise<void> {
  const batch = writeBatch(db);

  for (const { id, order } of categories) {
    const docRef = doc(db, COLLECTION_NAME, id);
    batch.update(docRef, { order });
  }

  await batch.commit();
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
