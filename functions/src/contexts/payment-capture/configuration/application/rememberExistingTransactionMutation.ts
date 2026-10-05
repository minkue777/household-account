import { createMerchantRuleMutation, unchangedMerchantRules } from "./merchantRuleMutation";
import type { MerchantRuleCommandState } from "./ports/in/merchantRuleCommandInputPort";
import { normalizeRememberedMerchant, rememberedExactRuleId } from "../domain/policies/rememberMerchantRule";

/** Called inside the caller's transaction; an existing exact rule is never overwritten. */
export function rememberExistingTransactionMutation(input: {
  current: MerchantRuleCommandState;
  householdId: string;
  memberId: string;
  originalMerchant: string;
  categoryId: string;
}) {
  const keyword = normalizeRememberedMerchant(input.originalMerchant);
  const existing = input.current.rules.find((rule) => rule.householdId === input.householdId && rule.matchType === "exact" && rule.normalizedKeywords.includes(keyword));
  if (existing !== undefined) return unchangedMerchantRules(input.current, { kind: "Updated", rule: existing });
  return createMerchantRuleMutation(input.current, input.householdId, {
    actor: { householdId: input.householdId, memberId: input.memberId, capability: "paymentConfiguration:manage" },
    ruleId: rememberedExactRuleId(input.householdId, keyword),
    keyword,
    matchType: "exact",
    active: true,
    mapping: { categoryId: input.categoryId },
  });
}
