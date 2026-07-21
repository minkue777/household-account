import { enrichPaymentDraft } from "../domain/policies/paymentDraftEnrichment";

export type EnrichmentBoundaryResult =
  | {
      kind: "Enriched";
      draft: { merchant: string; categoryId: string; memo: string };
      appliedBy: "merchant-rule" | "city-gas-parser" | "household-default";
    }
  | {
      kind: "Rejected";
      code: "DEFAULT_CATEGORY_MISSING" | "INVALID_CATEGORY_REFERENCE";
    }
  | {
      kind: "RetryableFailure";
      code: "MERCHANT_RULES_UNAVAILABLE" | "CATEGORY_REPOSITORY_UNAVAILABLE";
    };

export interface PaymentDraftEnrichmentBoundaryInput {
  parsed: {
    sourceKind: "payment" | "city-gas";
    merchant: string;
    categoryId?: string;
    memo: string;
  };
  merchantRuleLookup:
    | {
        kind: "Matched";
        mapping: { merchant?: string; categoryId?: string; memo?: string };
      }
    | { kind: "Unmatched" }
    | { kind: "Unavailable" };
  defaultCategoryLookup:
    | { kind: "Found"; categoryId: string }
    | { kind: "Missing" }
    | { kind: "InvalidReference" }
    | { kind: "Unavailable" };
}

function present(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== "";
}

export function enrichPaymentDraftAcrossBoundaries(
  input: PaymentDraftEnrichmentBoundaryInput,
): EnrichmentBoundaryResult {
  if (input.merchantRuleLookup.kind === "Unavailable") {
    return {
      kind: "RetryableFailure",
      code: "MERCHANT_RULES_UNAVAILABLE",
    };
  }

  const ruleMapping =
    input.merchantRuleLookup.kind === "Matched"
      ? input.merchantRuleLookup.mapping
      : undefined;
  const hasRuleCategory = present(ruleMapping?.categoryId);
  const hasParserCategory =
    input.parsed.sourceKind === "city-gas" &&
    present(input.parsed.categoryId);
  let defaultCategoryId = "";

  if (!hasRuleCategory && !hasParserCategory) {
    switch (input.defaultCategoryLookup.kind) {
      case "Found":
        defaultCategoryId = input.defaultCategoryLookup.categoryId;
        break;
      case "Missing":
        return { kind: "Rejected", code: "DEFAULT_CATEGORY_MISSING" };
      case "InvalidReference":
        return { kind: "Rejected", code: "INVALID_CATEGORY_REFERENCE" };
      case "Unavailable":
        return {
          kind: "RetryableFailure",
          code: "CATEGORY_REPOSITORY_UNAVAILABLE",
        };
    }
  }

  const enriched = enrichPaymentDraft({
    originalMerchant: input.parsed.merchant,
    parsedCategoryId: input.parsed.categoryId,
    parsedMemo: input.parsed.memo,
    sourceKind: input.parsed.sourceKind,
    householdDefaultCategoryId: defaultCategoryId,
    matchedRule: ruleMapping,
  });
  return {
    kind: "Enriched",
    draft: {
      merchant: enriched.merchant,
      categoryId: enriched.categoryId,
      memo: enriched.memo,
    },
    appliedBy: enriched.appliedBy,
  };
}
