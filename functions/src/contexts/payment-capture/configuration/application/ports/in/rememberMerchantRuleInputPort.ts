export interface RememberMerchantRuleInput {
  readonly householdId: string;
  readonly transactionId: string;
  readonly transactionType: "expense" | "income";
  readonly merchant: string;
  readonly categoryId: string;
  readonly rememberForNextTime: boolean;
}

export type RememberMerchantRuleResult =
  | { readonly kind: "ExpenseUpdatedAndRuleCreated"; readonly ruleId: string }
  | { readonly kind: "ExpenseUpdatedWithoutRule" }
  | { readonly kind: "RuleAlreadyExists"; readonly ruleId: string }
  | {
      readonly kind: "Rejected";
      readonly code: "REMEMBER_NOT_AVAILABLE_FOR_INCOME";
    };

export interface RememberMerchantRuleSnapshot {
  readonly transactions: readonly {
    readonly transactionId: string;
    readonly categoryId: string;
  }[];
  readonly rules: readonly {
    readonly ruleId: string;
    readonly householdId: string;
    readonly matchType: "exact";
    readonly keyword: string;
    readonly categoryId: string;
  }[];
}

export interface RememberMerchantRuleInputPort {
  save(input: RememberMerchantRuleInput): Promise<RememberMerchantRuleResult>;
  snapshot(): RememberMerchantRuleSnapshot;
}
