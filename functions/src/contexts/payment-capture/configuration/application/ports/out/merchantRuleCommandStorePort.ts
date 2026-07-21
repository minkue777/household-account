import type { MerchantRuleCommandState } from "../../../domain/model/merchantRuleSet";

export interface MerchantRuleTransactionDecision<T> {
  readonly state: MerchantRuleCommandState;
  readonly value: T;
  readonly writes: boolean;
}

export type MerchantRuleTransactionResult<T> =
  | { readonly kind: "Committed"; readonly value: T }
  | { readonly kind: "CommitFailed" };

export interface MerchantRuleCommandStorePort {
  read(): MerchantRuleCommandState;
  transact<T>(
    decide: (
      current: MerchantRuleCommandState,
    ) => MerchantRuleTransactionDecision<T>,
  ): MerchantRuleTransactionResult<T>;
}
