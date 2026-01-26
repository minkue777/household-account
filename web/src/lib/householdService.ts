import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { Household } from '@/types/household';
import { HouseholdStorage } from './storage/householdStorage';

export type { Household };

const householdsCollection = collection(db, 'households');

/**
 * 랜덤 키 생성 (Firebase 문서 ID 스타일: qpQ134bXYz2kABCdef12)
 */
function generateKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 20; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * 새 가구 키 생성
 */
export async function createHousehold(name?: string, customKey?: string): Promise<string> {
  let key = customKey || generateKey();

  // 중복 체크 (커스텀 키가 아닌 경우에만)
  if (!customKey) {
    let exists = await getDoc(doc(householdsCollection, key));
    while (exists.exists()) {
      key = generateKey();
      exists = await getDoc(doc(householdsCollection, key));
    }
  }

  await setDoc(doc(householdsCollection, key), {
    name: name || key,
    createdAt: serverTimestamp(),
    defaultCategoryKey: 'etc', // 기본 카테고리: 기타
  });

  return key;
}

/**
 * 가구 키 유효성 확인
 */
export async function validateHouseholdKey(key: string): Promise<boolean> {
  const docRef = doc(householdsCollection, key);
  const docSnap = await getDoc(docRef);
  return docSnap.exists();
}

/**
 * 가구 정보 가져오기
 */
export async function getHousehold(key: string): Promise<Household | null> {
  const docRef = doc(householdsCollection, key);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) return null;

  const data = docSnap.data();
  return {
    id: docSnap.id,
    name: data.name,
    createdAt: data.createdAt?.toDate() || new Date(),
    defaultCategoryKey: data.defaultCategoryKey,
  };
}

/**
 * 모든 가구 목록 가져오기
 */
export async function getAllHouseholds(): Promise<Household[]> {
  const snapshot = await getDocs(householdsCollection);
  return snapshot.docs.map(doc => ({
    id: doc.id,
    name: doc.data().name,
    createdAt: doc.data().createdAt?.toDate() || new Date(),
  }));
}

/**
 * 가구 삭제
 */
export async function deleteHousehold(key: string): Promise<void> {
  await deleteDoc(doc(householdsCollection, key));
}

/**
 * 기본 카테고리 설정
 */
export async function setDefaultCategoryKey(householdKey: string, categoryKey: string): Promise<void> {
  const docRef = doc(householdsCollection, householdKey);
  await updateDoc(docRef, { defaultCategoryKey: categoryKey });
}

/**
 * 로컬스토리지에서 가구 키 가져오기
 */
export function getStoredHouseholdKey(): string | null {
  return HouseholdStorage.get();
}

/**
 * 로컬스토리지에 가구 키 저장
 */
export function setStoredHouseholdKey(key: string): void {
  HouseholdStorage.set(key);
}

/**
 * 로컬스토리지에서 가구 키 삭제
 */
export function clearStoredHouseholdKey(): void {
  HouseholdStorage.clear();
}

/**
 * 기존 데이터 마이그레이션 (householdId 없는 문서에 추가)
 */
export async function migrateExpensesToHousehold(householdId: string): Promise<number> {
  const expensesRef = collection(db, 'expenses');
  const snapshot = await getDocs(expensesRef);

  let migratedCount = 0;

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    if (!data.householdId) {
      await setDoc(doc(db, 'expenses', docSnap.id), { ...data, householdId });
      migratedCount++;
    }
  }

  return migratedCount;
}
