import {
  collection,
  addDoc,
  deleteDoc,
  updateDoc,
  doc,
  query,
  where,
  getDocs,
  onSnapshot,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';

const COLLECTION_NAME = 'merchant_rules';

export interface MerchantRule {
  id: string;
  householdId: string;
  merchantKeyword: string;
  category: string;
  exactMatch: boolean;
}

/**
 * 규칙 추가
 */
export async function addMerchantRule(
  householdId: string,
  merchantKeyword: string,
  category: string,
  exactMatch: boolean = true
): Promise<string> {
  if (!householdId) return '';

  // 이미 같은 키워드 규칙이 있는지 확인
  const exists = await ruleExists(householdId, merchantKeyword);
  if (exists) {
    console.log('이미 규칙이 존재함:', merchantKeyword);
    return '';
  }

  const docRef = await addDoc(collection(db, COLLECTION_NAME), {
    householdId,
    merchantKeyword,
    category,
    exactMatch,
  });
  return docRef.id;
}

/**
 * 규칙 수정
 */
export async function updateMerchantRule(
  id: string,
  category: string
): Promise<void> {
  const docRef = doc(db, COLLECTION_NAME, id);
  await updateDoc(docRef, { category });
}

/**
 * 규칙 삭제
 */
export async function deleteMerchantRule(id: string): Promise<void> {
  const docRef = doc(db, COLLECTION_NAME, id);
  await deleteDoc(docRef);
}

/**
 * 같은 키워드 규칙이 있는지 확인 (householdId별로)
 */
export async function ruleExists(householdId: string, keyword: string): Promise<boolean> {
  const q = query(
    collection(db, COLLECTION_NAME),
    where('householdId', '==', householdId),
    where('merchantKeyword', '==', keyword)
  );
  const snapshot = await getDocs(q);
  return !snapshot.empty;
}

/**
 * 모든 규칙 실시간 구독 (householdId별로)
 */
export function subscribeToRules(
  householdId: string,
  callback: (rules: MerchantRule[]) => void
): () => void {
  if (!householdId) {
    callback([]);
    return () => {};
  }

  const q = query(
    collection(db, COLLECTION_NAME),
    where('householdId', '==', householdId)
  );

  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      const rules: MerchantRule[] = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      } as MerchantRule));
      callback(rules);
    },
    (error) => {
      console.error('Rules subscription error:', error);
      callback([]);
    }
  );

  return unsubscribe;
}

// householdId가 없는 가맹점 규칙에 householdId 추가 (마이그레이션)
export async function migrateRulesWithoutHouseholdId(householdId: string): Promise<number> {
  if (!householdId) return 0;

  const snapshot = await getDocs(collection(db, COLLECTION_NAME));
  const batch = writeBatch(db);
  let count = 0;

  snapshot.docs.forEach((docSnap) => {
    const data = docSnap.data();
    if (!data.householdId) {
      batch.update(docSnap.ref, { householdId });
      count++;
    }
  });

  if (count > 0) {
    await batch.commit();
    console.log(`${count}개의 가맹점 규칙에 householdId 추가됨`);
  }

  return count;
}
