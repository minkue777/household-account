import { merchantMutation } from "./paymentConfigurationRuntimeApplication";
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
  return merchantMutation(input.current, input.householdId, (application, state) => {
    const existing = state.rules.find((rule) => rule.householdId === input.householdId && rule.matchType === "exact" && rule.normalizedKeywords.includes(keyword));
    if (existing !== undefined) return { kind: "Updated", rule: existing };
    return application.create({
      actor: { householdId: input.householdId, memberId: input.memberId, capability: "paymentConfiguration:manage" },
      ruleId: rememberedExactRuleId(input.householdId, keyword),
      keyword,
      matchType: "exact",
      active: true,
      mapping: { categoryId: input.categoryId },
    });
  });
}
