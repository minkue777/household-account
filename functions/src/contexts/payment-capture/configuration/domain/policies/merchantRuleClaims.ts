import type {
  ExactMerchantKeywordClaim,
  MerchantRuleCommandState,
  MerchantRulePriorityClaim,
  MerchantRuleRecord,
} from "../model/merchantRuleSet";

function cloneRule(rule: MerchantRuleRecord): MerchantRuleRecord {
  return {
    ...rule,
    normalizedKeywords: [...rule.normalizedKeywords],
    mapping: { ...rule.mapping },
  };
}

export function buildMerchantRuleCommandState(input: {
  readonly rules: readonly MerchantRuleRecord[];
  readonly collectionVersions?: Readonly<Record<string, number>>;
}): MerchantRuleCommandState {
  const rules = input.rules.map(cloneRule);
  const exactKeywordClaims: ExactMerchantKeywordClaim[] = [];
  const priorityClaims: MerchantRulePriorityClaim[] = [];

  for (const rule of rules) {
    if (rule.matchType === "exact") {
      for (const token of new Set(rule.normalizedKeywords)) {
        exactKeywordClaims.push({ token, ruleId: rule.ruleId });
      }
    } else if (rule.priority !== undefined) {
      priorityClaims.push({
        matchType: rule.matchType,
        priority: rule.priority,
        ruleId: rule.ruleId,
      });
    }
  }

  return {
    rules,
    exactKeywordClaims,
    priorityClaims,
    collectionVersions: { ...(input.collectionVersions ?? {}) },
  };
}

export function cloneMerchantRuleCommandState(
  state: MerchantRuleCommandState,
): MerchantRuleCommandState {
  return {
    rules: state.rules.map(cloneRule),
    exactKeywordClaims: state.exactKeywordClaims.map((claim) => ({ ...claim })),
    priorityClaims: state.priorityClaims.map((claim) => ({ ...claim })),
    collectionVersions: { ...state.collectionVersions },
  };
}
