import {
  normalizedMerchantKeywordTokens,
  normalizeMerchantText,
} from "../value-objects/merchantKeyword";
import type { MerchantMatchType } from "../model/merchantRuleSet";

export type { MerchantMatchType } from "../model/merchantRuleSet";

export interface MerchantRuleCandidate {
  ruleId: string;
  keyword: string;
  matchType: MerchantMatchType;
  priority?: number;
  active: boolean;
  mapping: {
    merchant?: string;
    categoryId?: string;
    memo?: string;
  };
}

export type MerchantMappingField<TName extends string> =
  | { kind: "preserve" }
  | ({ kind: "replace" } & Record<TName, string>);

export interface MerchantMappingDecision {
  merchant: MerchantMappingField<"value">;
  category: MerchantMappingField<"categoryId">;
  memo: MerchantMappingField<"value">;
}

export type MerchantRuleSelectionResult =
  | {
      kind: "matched";
      ruleId: string;
      mapping: MerchantMappingDecision;
    }
  | { kind: "unmatched" }
  | { kind: "contractFailure"; code: "MERCHANT_RULE_CONFLICT" };

const MATCH_TYPE_ORDER: readonly MerchantMatchType[] = [
  "exact",
  "startsWith",
  "endsWith",
  "contains",
];

function keywordTokens(keyword: string): readonly string[] {
  return normalizedMerchantKeywordTokens(keyword).filter(
    (token) => token.length > 0,
  );
}

function matches(
  merchant: string,
  matchType: MerchantMatchType,
  token: string,
): boolean {
  switch (matchType) {
    case "exact":
      return merchant === token;
    case "startsWith":
      return merchant.startsWith(token);
    case "endsWith":
      return merchant.endsWith(token);
    case "contains":
      return merchant.includes(token);
  }
}

function hasCanonicalConflict(
  rules: readonly MerchantRuleCandidate[],
): boolean {
  const claims = new Map<string, string>();

  for (const rule of rules) {
    if (rule.matchType === "exact") {
      for (const token of keywordTokens(rule.keyword)) {
        const claim = `exact:${token}`;
        const owner = claims.get(claim);
        if (owner !== undefined && owner !== rule.ruleId) return true;
        claims.set(claim, rule.ruleId);
      }
      continue;
    }

    if (!Number.isInteger(rule.priority) || (rule.priority as number) <= 0) {
      return true;
    }
    const claim = `${rule.matchType}:${rule.priority as number}`;
    const owner = claims.get(claim);
    if (owner !== undefined && owner !== rule.ruleId) return true;
    claims.set(claim, rule.ruleId);
  }

  return false;
}

function replacement<TName extends string>(
  name: TName,
  value: string | undefined,
): MerchantMappingField<TName> {
  return value === undefined || value.trim() === ""
    ? { kind: "preserve" }
    : ({ kind: "replace", [name]: value } as {
        kind: "replace";
      } & Record<TName, string>);
}

export function selectMerchantRule(input: {
  merchant: string;
  memo: string;
  rules: readonly MerchantRuleCandidate[];
}): MerchantRuleSelectionResult {
  if (hasCanonicalConflict(input.rules)) {
    return { kind: "contractFailure", code: "MERCHANT_RULE_CONFLICT" };
  }

  const merchant = normalizeMerchantText(input.merchant);
  const activeMatches = input.rules.filter(
    (rule) =>
      rule.active &&
      keywordTokens(rule.keyword).some((token) =>
        matches(merchant, rule.matchType, token),
      ),
  );

  let selected: MerchantRuleCandidate | undefined;
  for (const matchType of MATCH_TYPE_ORDER) {
    const candidates = activeMatches.filter(
      (rule) => rule.matchType === matchType,
    );
    if (candidates.length === 0) continue;

    selected =
      matchType === "exact"
        ? candidates[0]
        : candidates
            .slice()
            .sort(
              (left, right) =>
                (right.priority as number) - (left.priority as number),
            )[0];
    break;
  }

  if (selected === undefined) return { kind: "unmatched" };

  return {
    kind: "matched",
    ruleId: selected.ruleId,
    mapping: {
      merchant: replacement("value", selected.mapping.merchant),
      category: replacement("categoryId", selected.mapping.categoryId),
      memo: replacement("value", selected.mapping.memo),
    },
  };
}
