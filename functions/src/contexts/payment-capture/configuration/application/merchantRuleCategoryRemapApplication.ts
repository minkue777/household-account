import type {
  MerchantRuleCategoryRemapInputPort,
  MerchantRuleCategoryRemapState,
  MerchantRuleRemapPageResult,
  RemappableMerchantRule,
} from "./ports/in/merchantRuleCategoryRemapInputPort";

const cloneRule = (rule: RemappableMerchantRule): RemappableMerchantRule => ({
  ...rule,
  mapping: { ...rule.mapping },
});

type AppliedResult = Extract<
  MerchantRuleRemapPageResult,
  { readonly kind: "PageApplied" }
>;

export function createMerchantRuleCategoryRemapApplication(
  initialRules: readonly RemappableMerchantRule[],
): MerchantRuleCategoryRemapInputPort {
  let rules = initialRules.map(cloneRule);
  const processedPages = new Map<
    string,
    { processId: string; cursor: string | null; result: AppliedResult }
  >();

  return {
    remapPage(input) {
      const pageKey = JSON.stringify([input.processId, input.cursor]);
      const previous = processedPages.get(pageKey);
      if (previous !== undefined) return { ...previous.result };

      const candidates = rules
        .filter(
          (rule) =>
            rule.householdId === input.householdId &&
            rule.mapping.categoryId === input.archivedCategoryId &&
            (input.cursor === null || rule.ruleId > input.cursor),
        )
        .sort((left, right) => left.ruleId.localeCompare(right.ruleId));
      const page = candidates.slice(0, Math.max(0, input.limit));

      if (input.commitOutcome === "failure") {
        return { kind: "RetryableFailure", code: "PAGE_COMMIT_FAILED" };
      }

      const changedIds = new Set(page.map(({ ruleId }) => ruleId));
      rules = rules.map((rule) =>
        changedIds.has(rule.ruleId)
          ? {
              ...rule,
              mapping: {
                ...rule.mapping,
                categoryId: input.defaultCategoryId,
              },
              version: rule.version + 1,
            }
          : rule,
      );

      const completed = candidates.length <= page.length;
      const result: AppliedResult = {
        kind: "PageApplied",
        processId: input.processId,
        cursor: input.cursor,
        changedCount: page.length,
        nextCursor:
          completed || page.length === 0
            ? null
            : page[page.length - 1].ruleId,
        completed,
      };
      processedPages.set(pageKey, {
        processId: input.processId,
        cursor: input.cursor,
        result,
      });
      return { ...result };
    },

    state(): MerchantRuleCategoryRemapState {
      return {
        rules: rules.map(cloneRule),
        processedPages: [...processedPages.values()].map((page) => ({
          processId: page.processId,
          cursor: page.cursor,
          result: { ...page.result },
        })),
      };
    },
  };
}
