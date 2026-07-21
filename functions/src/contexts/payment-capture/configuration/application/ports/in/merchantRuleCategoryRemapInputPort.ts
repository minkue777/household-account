export interface RemappableMerchantRule {
  readonly ruleId: string;
  readonly householdId: string;
  readonly keyword: string;
  readonly matchType: "exact" | "startsWith" | "endsWith" | "contains";
  readonly priority?: number;
  readonly active: boolean;
  readonly mapping: {
    readonly merchant?: string;
    readonly categoryId?: string;
    readonly memo?: string;
  };
  readonly version: number;
}

export type MerchantRuleRemapPageResult =
  | {
      readonly kind: "PageApplied";
      readonly processId: string;
      readonly cursor: string | null;
      readonly changedCount: number;
      readonly nextCursor: string | null;
      readonly completed: boolean;
    }
  | { readonly kind: "RetryableFailure"; readonly code: "PAGE_COMMIT_FAILED" };

export interface MerchantRuleCategoryRemapState {
  readonly rules: readonly RemappableMerchantRule[];
  readonly processedPages: readonly {
    readonly processId: string;
    readonly cursor: string | null;
    readonly result: Extract<
      MerchantRuleRemapPageResult,
      { readonly kind: "PageApplied" }
    >;
  }[];
}

export interface MerchantRuleCategoryRemapInputPort {
  remapPage(input: {
    readonly householdId: string;
    readonly archivedCategoryId: string;
    readonly defaultCategoryId: string;
    readonly processId: string;
    readonly cursor: string | null;
    readonly limit: number;
    readonly commitOutcome?: "success" | "failure";
  }): MerchantRuleRemapPageResult;
  state(): MerchantRuleCategoryRemapState;
}
