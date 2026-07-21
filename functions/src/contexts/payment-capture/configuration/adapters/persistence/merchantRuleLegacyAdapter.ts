import { normalizeMerchantText } from "../../domain/value-objects/merchantKeyword";

export type LegacyMerchantRuleReadResult =
  | {
      readonly kind: "Read";
      readonly rule: {
        readonly ruleId: string;
        readonly normalizedKeywords: readonly string[];
        readonly matchType: "exact" | "contains";
        readonly priority?: number;
        readonly active: boolean;
        readonly mapping: { readonly categoryId?: string };
      };
    }
  | {
      readonly kind: "ContractFailure";
      readonly code:
        | "EMPTY_KEYWORD"
        | "INVALID_CATEGORY_REFERENCE"
        | "INVALID_PRIORITY"
        | "REGEX_NOT_SUPPORTED";
    };

export function readLegacyMerchantRule(
  document: Readonly<Record<string, unknown>>,
): LegacyMerchantRuleReadResult {
  if (typeof document.keyword !== "string") {
    return { kind: "ContractFailure", code: "EMPTY_KEYWORD" };
  }
  const normalizedKeywords = document.keyword
    .split(",")
    .map(normalizeMerchantText)
    .filter((keyword) => keyword.length > 0);
  if (normalizedKeywords.length === 0) {
    return { kind: "ContractFailure", code: "EMPTY_KEYWORD" };
  }

  if (
    document.category !== undefined &&
    (typeof document.category !== "string" ||
      document.category.trim().length === 0)
  ) {
    return { kind: "ContractFailure", code: "INVALID_CATEGORY_REFERENCE" };
  }

  if (
    document.priority !== undefined &&
    (!Number.isInteger(document.priority) || (document.priority as number) <= 0)
  ) {
    return { kind: "ContractFailure", code: "INVALID_PRIORITY" };
  }

  if (
    document.matchType !== undefined &&
    document.matchType !== "exact" &&
    document.matchType !== "contains"
  ) {
    return { kind: "ContractFailure", code: "REGEX_NOT_SUPPORTED" };
  }

  const matchType =
    document.matchType === "exact" || document.matchType === "contains"
      ? document.matchType
      : document.exactMatch === true
        ? "exact"
        : "contains";
  const priority =
    document.priority === undefined
      ? undefined
      : (document.priority as number);
  const categoryId =
    typeof document.category === "string" ? document.category : undefined;

  return {
    kind: "Read",
    rule: {
      ruleId:
        typeof document.ruleId === "string" ? document.ruleId : "legacy-rule",
      normalizedKeywords,
      matchType,
      ...(priority === undefined ? {} : { priority }),
      active: document.active === false ? false : true,
      mapping: categoryId === undefined ? {} : { categoryId },
    },
  };
}
