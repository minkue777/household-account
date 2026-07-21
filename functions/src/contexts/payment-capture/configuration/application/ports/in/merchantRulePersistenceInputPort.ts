export type PersistedMerchantMatchType =
  | "exact"
  | "startsWith"
  | "endsWith"
  | "contains";

export interface PersistedMerchantRuleView {
  readonly ruleId: string;
  readonly keyword: string;
  readonly normalizedKeywords: readonly string[];
  readonly matchType: PersistedMerchantMatchType;
  readonly priority?: number;
  readonly active: boolean;
  readonly mapping: {
    readonly merchant?: string;
    readonly categoryId?: string;
    readonly memo?: string;
  };
  readonly version: number;
}

export type MerchantRulePersistenceFixture =
  | {
      readonly ruleId: string;
      readonly keyword: string;
      readonly exactMatch: boolean;
      readonly category?: string;
      readonly active?: boolean;
    }
  | PersistedMerchantRuleView;

export interface MerchantRulePersistenceCommand {
  readonly commandId: string;
  readonly ruleId: string;
  readonly keyword: string;
  readonly matchType: PersistedMerchantMatchType;
  readonly priority?: number;
  readonly active: boolean;
  readonly mapping: { readonly categoryId?: string };
}

export type MerchantRulePersistenceWriteResult =
  | {
      readonly kind: "Created" | "Updated";
      readonly rule: PersistedMerchantRuleView;
    }
  | { readonly kind: "Duplicate"; readonly code: "EXACT_KEYWORD_CONFLICT" }
  | {
      readonly kind: "PriorityConflict";
      readonly code: "MERCHANT_RULE_PRIORITY_CONFLICT";
    };

export interface MerchantRuleClaimView {
  readonly kind: "exactKeyword" | "nonExactPriority";
  readonly matchType: PersistedMerchantMatchType;
  readonly value: string;
  readonly ruleId: string;
}

export interface MerchantRulePersistenceState {
  readonly rules: readonly PersistedMerchantRuleView[];
  readonly claims: readonly MerchantRuleClaimView[];
}

export interface MerchantRulePersistenceInputPort {
  read(document: MerchantRulePersistenceFixture): PersistedMerchantRuleView;
  createConcurrently(
    commands: readonly MerchantRulePersistenceCommand[],
  ): Promise<readonly MerchantRulePersistenceWriteResult[]>;
  updateConcurrently(
    commands: readonly (MerchantRulePersistenceCommand & {
      readonly expectedVersion: number;
    })[],
  ): Promise<readonly MerchantRulePersistenceWriteResult[]>;
  state(): MerchantRulePersistenceState;
}
