import type { MerchantRuleCandidate } from "../../../../configuration/public";

export interface CaptureConfigurationCard {
  readonly cardId: string;
  readonly ownerMemberId: string;
  readonly companyLabel: string;
  readonly lastFour?: string;
  readonly lifecycleState: "active" | "retired";
}

export interface CaptureConfigurationSnapshot {
  readonly cards: readonly CaptureConfigurationCard[];
  readonly merchantRules: readonly MerchantRuleCandidate[];
  readonly activeCategoryIds: ReadonlySet<string>;
  readonly defaultCategoryId?: string;
}

export type CaptureConfigurationQueryResult =
  | { readonly kind: "available"; readonly value: CaptureConfigurationSnapshot }
  | {
      readonly kind: "retryable-failure";
      readonly code: "PAYMENT_CONFIGURATION_UNAVAILABLE";
    };

export interface CaptureConfigurationQueryPort {
  load(input: {
    readonly householdId: string;
    readonly actingMemberId: string;
  }): Promise<CaptureConfigurationQueryResult>;
}
