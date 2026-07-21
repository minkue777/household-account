import {
  findRememberedExactRule,
  normalizeRememberedMerchant,
  rememberedExactRuleId,
} from "../domain/policies/rememberMerchantRule";
import type {
  EditableRememberTransaction,
  RememberedExactRule,
  RememberExistingTransactionInputPort,
  RememberExistingTransactionState,
} from "./ports/in/rememberExistingTransactionInputPort";

export function createRememberExistingTransactionApplication(options: {
  readonly transactions: readonly EditableRememberTransaction[];
  readonly rules?: readonly RememberedExactRule[];
}): RememberExistingTransactionInputPort {
  let transactions = options.transactions.map((transaction) => ({ ...transaction }));
  let rules = (options.rules ?? []).map((rule) => ({ ...rule }));
  let exactClaims = rules.map(({ normalizedKeyword, ruleId }) => ({
    normalizedKeyword,
    ruleId,
  }));

  return {
    update(input) {
      const transactionIndex = transactions.findIndex(
        ({ transactionId }) => transactionId === input.transactionId,
      );
      if (transactionIndex < 0) return { kind: "NotFound" };

      const transaction = transactions[transactionIndex];
      if (transaction.householdId !== input.actor.householdId) {
        return { kind: "Forbidden", code: "HOUSEHOLD_FORBIDDEN" };
      }
      if (transaction.version !== input.expectedVersion) {
        return { kind: "Conflict", code: "TRANSACTION_VERSION_MISMATCH" };
      }
      if (
        transaction.transactionType === "income" &&
        input.rememberForNextTime
      ) {
        return {
          kind: "Rejected",
          code: "REMEMBER_NOT_AVAILABLE_FOR_INCOME",
        };
      }
      if (input.commitOutcome === "failure") {
        return { kind: "RetryableFailure", code: "ATOMIC_COMMIT_FAILED" };
      }

      const updatedTransaction = {
        ...transaction,
        categoryId: input.categoryId,
        version: transaction.version + 1,
      };

      if (!input.rememberForNextTime) {
        transactions = transactions.map((current, index) =>
          index === transactionIndex ? updatedTransaction : current,
        );
        return {
          kind: "UpdatedWithoutRule",
          transactionId: transaction.transactionId,
          transactionVersion: updatedTransaction.version,
        };
      }

      const normalizedKeyword = normalizeRememberedMerchant(transaction.merchant);
      const existing = findRememberedExactRule(
        rules,
        transaction.householdId,
        normalizedKeyword,
      );
      transactions = transactions.map((current, index) =>
        index === transactionIndex ? updatedTransaction : current,
      );
      if (existing !== undefined) {
        return {
          kind: "UpdatedAndExistingRuleReused",
          transactionId: transaction.transactionId,
          transactionVersion: updatedTransaction.version,
          ruleId: existing.ruleId,
        };
      }

      const rule: RememberedExactRule = {
        ruleId: rememberedExactRuleId(
          transaction.householdId,
          normalizedKeyword,
        ),
        householdId: transaction.householdId,
        normalizedKeyword,
        categoryId: input.categoryId,
      };
      rules = [...rules, rule];
      exactClaims = [
        ...exactClaims,
        { normalizedKeyword, ruleId: rule.ruleId },
      ];
      return {
        kind: "UpdatedAndRuleCreated",
        transactionId: transaction.transactionId,
        transactionVersion: updatedTransaction.version,
        ruleId: rule.ruleId,
      };
    },

    state(): RememberExistingTransactionState {
      return {
        transactions: transactions.map((transaction) => ({ ...transaction })),
        rules: rules.map((rule) => ({ ...rule })),
        exactClaims: exactClaims.map((claim) => ({ ...claim })),
      };
    },
  };
}
