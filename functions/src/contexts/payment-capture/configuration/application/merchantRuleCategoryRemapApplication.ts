import type { RemappableMerchantRule } from "./ports/in/merchantRuleCategoryRemapInputPort";

export interface MerchantRuleRemapPage {
  readonly householdId: string;
  readonly archivedCategoryId: string;
  readonly defaultCategoryId: string;
  readonly processId: string;
  readonly cursor: string | null;
  readonly limit: number;
}

export function remapMerchantRulePage<T extends RemappableMerchantRule>(rules: readonly T[], input: MerchantRuleRemapPage) {
  const candidates = rules.filter(rule => rule.householdId === input.householdId
    && rule.mapping.categoryId === input.archivedCategoryId && (input.cursor === null || rule.ruleId > input.cursor))
    .sort((left, right) => left.ruleId.localeCompare(right.ruleId));
  const page = candidates.slice(0, Math.max(0, input.limit));
  const ids = new Set(page.map(rule => rule.ruleId));
  const completed = candidates.length <= page.length;
  return {
    rules: rules.map(rule => ids.has(rule.ruleId)
      ? { ...rule, mapping: { ...rule.mapping, categoryId: input.defaultCategoryId }, version: rule.version + 1 } : rule),
    changedTypes: new Set(page.map(rule => rule.matchType)),
    result: {
      kind: "PageApplied" as const, processId: input.processId, cursor: input.cursor, changedCount: page.length,
      nextCursor: completed || page.length === 0 ? null : page[page.length - 1].ruleId, completed,
    },
  };
}
