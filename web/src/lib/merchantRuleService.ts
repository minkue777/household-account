import {
  collection,
  doc,
  getDoc,
  query,
  where,
  getDocs,
  onSnapshot,
  db,
  type QueryDocumentSnapshot,
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

function ruleCollection(householdId: string) {
  return collection(db, 'households', householdId, 'merchantRules');
}

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
    ruleCollection(householdId),
    where('keyword', '==', keyword),
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
    ruleCollection(householdId),
    where('keyword', '==', keyword)
  );
  const snapshot = await getDocs(q);
  return !snapshot.empty;
}

/**
 * canonical 결제 설정 문서를 화면 모델로 변환합니다.
 */
function mapDocToRule(doc: QueryDocumentSnapshot): MerchantRule {
  const data = doc.data();
  return {
    id: doc.id,
    version: Number.isSafeInteger(data.aggregateVersion) ? data.aggregateVersion : 1,
    householdId: data.householdId,
    merchantKeyword: data.keyword,
    matchType: data.matchType,
    mapping: {
      ...(data.mapping?.merchant === undefined ? {} : { merchant: data.mapping.merchant }),
      ...(data.mapping?.categoryId === undefined ? {} : { category: data.mapping.categoryId }),
      ...(data.mapping?.memo === undefined ? {} : { memo: data.mapping.memo }),
    },
    priority: data.priority ?? 0,
    isActive: data.active ?? true,
    createdAt: data.createdAt?.toDate?.() ?? undefined,
    updatedAt: data.updatedAt?.toDate?.() ?? undefined,
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

  const q = ruleCollection(householdId);

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

  const q = ruleCollection(householdId);

  const [snapshot, meta] = await Promise.all([getDocs(q), getDoc(doc(db, 'households', householdId, 'paymentConfigurationMeta', 'merchant-rules'))]);
  const versions = meta.data()?.collectionVersions ?? {};
  return snapshot.docs.map(mapDocToRule).map((rule) => ({ ...rule, collectionVersion: versions[`${householdId}:${rule.matchType}`] ?? 0 }));
}
