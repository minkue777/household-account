import {
  collection,
  doc,
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
    throw new Error('인증된 가구 세션이 필요합니다.');
  }

  const { paymentConfigurationCommands } = await import(
    '@/features/payment-configuration/application/paymentConfigurationCommands'
  );
  return paymentConfigurationCommands.createMerchantRule(householdId, input);
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
  callback: (rules: MerchantRule[]) => void,
  onError: (error: unknown) => void,
): () => void {
  if (!householdId) {
    callback([]);
    return () => {};
  }

  const q = ruleCollection(householdId);

  let active = true;
  const fail = (error: unknown) => {
    if (!active) return;
    active = false;
    onError(error);
  };
  let latestRules: MerchantRule[] | undefined;
  let versions: Record<string, number> | undefined;
  const publish = () => {
    if (active && latestRules !== undefined && versions !== undefined) callback(latestRules.map((rule) => ({ ...rule, collectionVersion: versions![`${householdId}:${rule.matchType}`] ?? 0 })));
  };
  const stopMeta = onSnapshot(doc(db, 'households', householdId, 'paymentConfigurationMeta', 'merchant-rules'), (snapshot) => {
    versions = snapshot.data()?.collectionVersions ?? {};
    publish();
  }, fail);
  let unsubscribe: () => void;
  try { unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      const rules: MerchantRule[] = snapshot.docs.map(mapDocToRule);
      latestRules = rules;
      publish();
    },
    fail
  ); } catch (error) { stopMeta(); fail(error); return () => {}; }

  return () => { active = false; unsubscribe(); stopMeta(); };
}
