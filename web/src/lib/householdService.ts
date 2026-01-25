import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';

export interface Household {
  id: string;
  name: string;
  createdAt: Date;
}

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
export async function createHousehold(name?: string): Promise<string> {
  let key = generateKey();

  // 중복 체크
  let exists = await getDoc(doc(householdsCollection, key));
  while (exists.exists()) {
    key = generateKey();
    exists = await getDoc(doc(householdsCollection, key));
  }

  await setDoc(doc(householdsCollection, key), {
    name: name || key,
    createdAt: serverTimestamp(),
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
 * 로컬스토리지에서 가구 키 가져오기
 */
export function getStoredHouseholdKey(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('householdKey');
}

/**
 * 로컬스토리지에 가구 키 저장
 */
export function setStoredHouseholdKey(key: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('householdKey', key);
}

/**
 * 로컬스토리지에서 가구 키 삭제
 */
export function clearStoredHouseholdKey(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('householdKey');
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
