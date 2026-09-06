import {
  collection,
  doc,
  getDoc,
  query,
  where,
  getDocs,
  onSnapshot,
  db,
} from '@/platform/read-model/firestoreReadModel';
import {
  MerchantRule,
  MatchType,
  MerchantRuleMapping,
  CreateMerchantRuleInput,
  MATCH_TYPE_LABELS,
} from '@/types/merchant';
import { requireClientSessionScope } from '@/composition/clientSessionScope';

export type { MerchantRule, MatchType, MerchantRuleMapping, CreateMerchantRuleInput };
export { MATCH_TYPE_LABELS };

const COLLECTION_NAME = 'merchant_rules';

function requireHouseholdId(): string {
  return requireClientSessionScope().householdId;
}

export async function addMerchantRuleV2(
  householdId: string,
  input: CreateMerchantRuleInput
): Promise<string> {
  if (!householdId) {
    console.log('[merchantRule] householdId 없음');
    return '';
  }

  const { paymentConfigurationCommands } = await import(
    '@/features/payment-configuration/application/paymentConfigurationCommands'
  );
  return paymentConfigurationCommands.createMerchantRule(householdId, input);
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
  updates: Partial<Pick<MerchantRule, 'merchantKeyword' | 'matchType' | 'mapping' | 'priority' | 'isActive'>>,
  expectedVersion: number
): Promise<void> {
  const { paymentConfigurationCommands } = await import(
    '@/features/payment-configuration/application/paymentConfigurationCommands'
  );
  await paymentConfigurationCommands.updateMerchantRule(requireHouseholdId(), id, updates, expectedVersion);
}

/**
 * 규칙 수정 (하위 호환성 유지)
 * @deprecated Use updateMerchantRuleV2 instead
 */
export async function updateMerchantRule(
  id: string,
  category: string,
  expectedVersion: number
): Promise<void> {
  await updateMerchantRuleV2(id, {
    mapping: { category },
  }, expectedVersion);
}

/**
 * 규칙 삭제
 */
export async function deleteMerchantRule(id: string, expectedVersion: number): Promise<void> {
  const { paymentConfigurationCommands } = await import(
    '@/features/payment-configuration/application/paymentConfigurationCommands'
  );
  await paymentConfigurationCommands.deleteMerchantRule(requireHouseholdId(), id, expectedVersion);
}

export async function reorderMerchantRules(householdId: string, matchType: Exclude<MatchType, 'exact'>, rules: readonly MerchantRule[]): Promise<void> {
  const { paymentConfigurationCommands } = await import('@/features/payment-configuration/application/paymentConfigurationCommands');
  await paymentConfigurationCommands.reorderMerchantRules(householdId, matchType, rules.map((rule) => rule.id), rules[0]?.collectionVersion ?? 0);
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
    version: Number.isSafeInteger(data.aggregateVersion) ? data.aggregateVersion : 1,
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

  let latestRules: MerchantRule[] | undefined;
  let versions: Record<string, number> | undefined;
  const publish = () => {
    if (latestRules !== undefined && versions !== undefined) callback(latestRules.map((rule) => ({ ...rule, collectionVersion: versions![`${householdId}:${rule.matchType}`] ?? 0 })));
  };
  const stopMeta = onSnapshot(doc(db, 'households', householdId, 'paymentConfigurationMeta', 'merchant-rules'), (snapshot) => {
    versions = snapshot.data()?.collectionVersions ?? {};
    publish();
  }, () => callback([]));
  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      const rules: MerchantRule[] = snapshot.docs.map(mapDocToRule);
      latestRules = rules;
      publish();
    },
    (error) => {
      callback([]);
    }
  );

  return () => { unsubscribe(); stopMeta(); };
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

  const [snapshot, meta] = await Promise.all([getDocs(q), getDoc(doc(db, 'households', householdId, 'paymentConfigurationMeta', 'merchant-rules'))]);
  const versions = meta.data()?.collectionVersions ?? {};
  return snapshot.docs.map(mapDocToRule).map((rule) => ({ ...rule, collectionVersion: versions[`${householdId}:${rule.matchType}`] ?? 0 }));
}
