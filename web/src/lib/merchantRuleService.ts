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
  orderBy,
  Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  MerchantRule,
  MatchType,
  MerchantRuleMapping,
  CreateMerchantRuleInput,
  AppliedRule,
} from '@/types/merchant';

export type { MerchantRule, MatchType, MerchantRuleMapping, CreateMerchantRuleInput, AppliedRule };

const COLLECTION_NAME = 'merchant_rules';

/**
 * 가맹점명이 규칙과 매칭되는지 확인
 */
export function matchesMerchant(
  merchantName: string,
  keyword: string,
  matchType: MatchType
): boolean {
  const normalizedMerchant = merchantName.toLowerCase().trim();
  const normalizedKeyword = keyword.toLowerCase().trim();

  switch (matchType) {
    case 'exact':
      return normalizedMerchant === normalizedKeyword;
    case 'contains':
      return normalizedMerchant.includes(normalizedKeyword);
    case 'startsWith':
      return normalizedMerchant.startsWith(normalizedKeyword);
    case 'endsWith':
      return normalizedMerchant.endsWith(normalizedKeyword);
    case 'regex':
      try {
        const regex = new RegExp(keyword, 'i');
        return regex.test(merchantName);
      } catch {
        console.warn('Invalid regex pattern:', keyword);
        return false;
      }
    default:
      return false;
  }
}

/**
 * 가맹점명에 매칭되는 규칙 찾기
 * 우선순위: priority 높은 순 > exact > startsWith > endsWith > contains > regex
 */
export function findMatchingRule(
  merchantName: string,
  rules: MerchantRule[]
): MerchantRule | null {
  // 활성화된 규칙만 필터링
  const activeRules = rules.filter((rule) => rule.isActive !== false);

  // 우선순위별로 정렬 (priority 높은 순, 같으면 matchType 우선순위)
  const matchTypePriority: Record<MatchType, number> = {
    exact: 5,
    startsWith: 4,
    endsWith: 3,
    contains: 2,
    regex: 1,
  };

  const sortedRules = [...activeRules].sort((a, b) => {
    const priorityA = a.priority ?? 0;
    const priorityB = b.priority ?? 0;
    if (priorityA !== priorityB) return priorityB - priorityA;
    return matchTypePriority[b.matchType] - matchTypePriority[a.matchType];
  });

  // 매칭되는 첫 번째 규칙 반환
  for (const rule of sortedRules) {
    // 하위 호환성: exactMatch 필드가 있으면 matchType으로 변환
    const matchType = rule.matchType ?? (rule.exactMatch ? 'exact' : 'contains');
    if (matchesMerchant(merchantName, rule.merchantKeyword, matchType)) {
      return rule;
    }
  }

  return null;
}

/**
 * 가맹점명에 규칙을 적용하여 매핑된 값 반환
 */
export function applyRule(
  merchantName: string,
  rules: MerchantRule[]
): AppliedRule | null {
  const rule = findMatchingRule(merchantName, rules);
  if (!rule) return null;

  // 하위 호환성: mapping이 없으면 category 필드 사용
  const mapping = rule.mapping ?? { category: rule.category };

  return {
    rule,
    mappedValues: {
      merchant: mapping.merchant ?? merchantName,
      category: mapping.category ?? 'etc',
      memo: mapping.memo ?? '',
    },
  };
}

/**
 * 규칙 추가 (새로운 API)
 */
export async function addMerchantRuleV2(
  householdId: string,
  input: CreateMerchantRuleInput
): Promise<string> {
  if (!householdId) return '';

  // 이미 같은 키워드/매칭타입 조합이 있는지 확인
  const exists = await ruleExistsV2(householdId, input.merchantKeyword, input.matchType);
  if (exists) {
    console.log('이미 규칙이 존재함:', input.merchantKeyword, input.matchType);
    return '';
  }

  const docRef = await addDoc(collection(db, COLLECTION_NAME), {
    householdId,
    merchantKeyword: input.merchantKeyword,
    matchType: input.matchType,
    mapping: input.mapping,
    priority: input.priority ?? 0,
    isActive: true,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });

  return docRef.id;
}

/**
 * 규칙 추가 (하위 호환성 유지)
 * @deprecated Use addMerchantRuleV2 instead
 */
export async function addMerchantRule(
  householdId: string,
  merchantKeyword: string,
  category: string,
  exactMatch: boolean = true
): Promise<string> {
  return addMerchantRuleV2(householdId, {
    merchantKeyword,
    matchType: exactMatch ? 'exact' : 'contains',
    mapping: { category },
  });
}

/**
 * 규칙 수정 (새로운 API)
 */
export async function updateMerchantRuleV2(
  id: string,
  updates: Partial<Pick<MerchantRule, 'merchantKeyword' | 'matchType' | 'mapping' | 'priority' | 'isActive'>>
): Promise<void> {
  const docRef = doc(db, COLLECTION_NAME, id);
  await updateDoc(docRef, {
    ...updates,
    updatedAt: Timestamp.now(),
  });
}

/**
 * 규칙 수정 (하위 호환성 유지)
 * @deprecated Use updateMerchantRuleV2 instead
 */
export async function updateMerchantRule(
  id: string,
  category: string
): Promise<void> {
  await updateMerchantRuleV2(id, {
    mapping: { category },
  });
}

/**
 * 규칙 삭제
 */
export async function deleteMerchantRule(id: string): Promise<void> {
  const docRef = doc(db, COLLECTION_NAME, id);
  await deleteDoc(docRef);
}

/**
 * 같은 키워드/매칭타입 규칙이 있는지 확인 (새로운 API)
 */
export async function ruleExistsV2(
  householdId: string,
  keyword: string,
  matchType: MatchType
): Promise<boolean> {
  const q = query(
    collection(db, COLLECTION_NAME),
    where('householdId', '==', householdId),
    where('merchantKeyword', '==', keyword),
    where('matchType', '==', matchType)
  );
  const snapshot = await getDocs(q);
  return !snapshot.empty;
}

/**
 * 같은 키워드 규칙이 있는지 확인 (하위 호환성)
 * @deprecated Use ruleExistsV2 instead
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
 * Firestore 문서를 MerchantRule로 변환 (하위 호환성 처리)
 */
function mapDocToRule(doc: any): MerchantRule {
  const data = doc.data();
  return {
    id: doc.id,
    householdId: data.householdId,
    merchantKeyword: data.merchantKeyword,
    // 하위 호환성: matchType이 없으면 exactMatch로 판단
    matchType: data.matchType ?? (data.exactMatch ? 'exact' : 'contains'),
    // 하위 호환성: mapping이 없으면 category로 생성
    mapping: data.mapping ?? { category: data.category },
    priority: data.priority ?? 0,
    isActive: data.isActive ?? true,
    createdAt: data.createdAt?.toDate?.() ?? undefined,
    updatedAt: data.updatedAt?.toDate?.() ?? undefined,
    // deprecated 필드도 포함 (하위 호환성)
    category: data.category,
    exactMatch: data.exactMatch,
  };
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
      const rules: MerchantRule[] = snapshot.docs.map(mapDocToRule);
      callback(rules);
    },
    (error) => {
      console.error('Rules subscription error:', error);
      callback([]);
    }
  );

  return unsubscribe;
}

/**
 * 규칙 목록 일회성 조회
 */
export async function getRules(householdId: string): Promise<MerchantRule[]> {
  if (!householdId) return [];

  const q = query(
    collection(db, COLLECTION_NAME),
    where('householdId', '==', householdId)
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map(mapDocToRule);
}
