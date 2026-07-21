import {
  findRememberedExactRule,
  normalizeRememberedMerchant,
  rememberedExactRuleId,
} from "../domain/policies/rememberMerchantRule";
import type {
  RememberMerchantRuleInputPort,
  RememberMerchantRuleSnapshot,
} from "./ports/in/rememberMerchantRuleInputPort";

interface StoredRule {
  ruleId: string;
  householdId: string;
  normalizedKeyword: string;
  categoryId: string;
}

export function createRememberMerchantRuleApplication(): RememberMerchantRuleInputPort {
  let transactions: { transactionId: string; categoryId: string }[] = [];
  let rules: StoredRule[] = [];

  return {
    async save(input) {
      if (input.transactionType === "income") {
        return {
          kind: "Rejected",
          code: "REMEMBER_NOT_AVAILABLE_FOR_INCOME",
        };
      }

      const nextTransaction = {
        transactionId: input.transactionId,
        categoryId: input.categoryId,
      };
      const transactionIndex = transactions.findIndex(
        ({ transactionId }) => transactionId === input.transactionId,
      );
      transactions =
        transactionIndex < 0
          ? [...transactions, nextTransaction]
          : transactions.map((transaction, index) =>
              index === transactionIndex ? nextTransaction : transaction,
            );

      if (!input.rememberForNextTime) {
        return { kind: "ExpenseUpdatedWithoutRule" };
      }

      const normalizedKeyword = normalizeRememberedMerchant(input.merchant);
      const existing = findRememberedExactRule(
        rules,
        input.householdId,
        normalizedKeyword,
      );
      if (existing !== undefined) {
        return { kind: "RuleAlreadyExists", ruleId: existing.ruleId };
      }

      const rule: StoredRule = {
        ruleId: rememberedExactRuleId(input.householdId, normalizedKeyword),
        householdId: input.householdId,
        normalizedKeyword,
        categoryId: input.categoryId,
      };
      rules = [...rules, rule];
      return { kind: "ExpenseUpdatedAndRuleCreated", ruleId: rule.ruleId };
    },

    snapshot(): RememberMerchantRuleSnapshot {
      return {
        transactions: transactions.map((transaction) => ({ ...transaction })),
        rules: rules.map((rule) => ({
          ruleId: rule.ruleId,
          householdId: rule.householdId,
          matchType: "exact",
          keyword: rule.normalizedKeyword,
          categoryId: rule.categoryId,
        })),
      };
    },
  };
}
