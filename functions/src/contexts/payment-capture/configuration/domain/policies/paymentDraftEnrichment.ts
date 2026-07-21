export interface PaymentDraftEnrichmentInput {
  originalMerchant: string;
  parsedCategoryId?: string;
  parsedMemo: string;
  sourceKind: "city-gas" | "payment";
  householdDefaultCategoryId: string;
  matchedRule?: {
    merchant?: string;
    categoryId?: string;
    memo?: string;
  };
}

export interface EnrichedPaymentDraft {
  merchant: string;
  categoryId: string;
  memo: string;
  appliedBy: "merchant-rule" | "city-gas-parser" | "household-default";
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value;
}

export function enrichPaymentDraft(
  input: PaymentDraftEnrichmentInput,
): EnrichedPaymentDraft {
  const parserCategory = nonEmpty(input.parsedCategoryId);
  const baseCategory =
    input.sourceKind === "city-gas" && parserCategory !== undefined
      ? parserCategory
      : input.householdDefaultCategoryId;
  const baseAppliedBy =
    input.sourceKind === "city-gas" && parserCategory !== undefined
      ? "city-gas-parser"
      : "household-default";

  if (input.matchedRule === undefined) {
    return {
      merchant: input.originalMerchant,
      categoryId: baseCategory,
      memo: input.parsedMemo,
      appliedBy: baseAppliedBy,
    };
  }

  return {
    merchant: nonEmpty(input.matchedRule.merchant) ?? input.originalMerchant,
    categoryId: nonEmpty(input.matchedRule.categoryId) ?? baseCategory,
    memo: nonEmpty(input.matchedRule.memo) ?? input.parsedMemo,
    appliedBy: "merchant-rule",
  };
}
