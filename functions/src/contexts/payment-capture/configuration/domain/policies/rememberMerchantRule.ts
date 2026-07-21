import { normalizeMerchantText } from "../value-objects/merchantKeyword";

export interface RememberableExactRule {
  readonly ruleId: string;
  readonly householdId: string;
  readonly normalizedKeyword: string;
  readonly categoryId: string;
}

export function normalizeRememberedMerchant(merchant: string): string {
  return normalizeMerchantText(merchant);
}

export function findRememberedExactRule(
  rules: readonly RememberableExactRule[],
  householdId: string,
  normalizedKeyword: string,
): RememberableExactRule | undefined {
  return rules.find(
    (rule) =>
      rule.householdId === householdId &&
      rule.normalizedKeyword === normalizedKeyword,
  );
}

export function rememberedExactRuleId(
  householdId: string,
  normalizedKeyword: string,
): string {
  const canonical = `${householdId}:${normalizedKeyword}`;
  let hash = 2_166_136_261;
  for (const character of canonical) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return `merchant-rule-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
