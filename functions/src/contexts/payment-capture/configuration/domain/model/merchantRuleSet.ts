export type MerchantMatchType =
  | "exact"
  | "startsWith"
  | "endsWith"
  | "contains";

export interface MerchantRuleActor {
  readonly householdId: string;
  readonly memberId: string;
  readonly capability: "paymentConfiguration:manage";
}

export interface MerchantRuleMapping {
  readonly merchant?: string;
  readonly categoryId?: string;
  readonly memo?: string;
}

export interface MerchantRuleRecord {
  readonly ruleId: string;
  readonly householdId: string;
  readonly keyword: string;
  readonly normalizedKeywords: readonly string[];
  readonly matchType: MerchantMatchType;
  readonly priority?: number;
  readonly active: boolean;
  readonly mapping: MerchantRuleMapping;
  readonly version: number;
}

export interface ExactMerchantKeywordClaim {
  readonly token: string;
  readonly ruleId: string;
}

export interface MerchantRulePriorityClaim {
  readonly matchType: Exclude<MerchantMatchType, "exact">;
  readonly priority: number;
  readonly ruleId: string;
}

export interface MerchantRuleCommandState {
  readonly rules: readonly MerchantRuleRecord[];
  readonly exactKeywordClaims: readonly ExactMerchantKeywordClaim[];
  readonly priorityClaims: readonly MerchantRulePriorityClaim[];
  readonly collectionVersions: Readonly<Record<string, number>>;
}
