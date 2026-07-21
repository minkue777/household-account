import { describe, expect, it } from "vitest";
import { createPaymentDraftEnrichmentBoundary } from "../../../../src/contexts/payment-capture/configuration/public";

type EnrichmentBoundaryResult =
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

export interface PaymentDraftEnrichmentBoundariesSubject {
  enrich(input: {
    parsed: {
      sourceKind: "payment" | "city-gas";
      merchant: string;
      categoryId?: string;
      memo: string;
    };
    merchantRuleLookup:
      | { kind: "Matched"; mapping: { merchant?: string; categoryId?: string; memo?: string } }
      | { kind: "Unmatched" }
      | { kind: "Unavailable" };
    defaultCategoryLookup:
      | { kind: "Found"; categoryId: string }
      | { kind: "Missing" }
      | { kind: "InvalidReference" }
      | { kind: "Unavailable" };
  }): EnrichmentBoundaryResult;
}

export function createSubject(): PaymentDraftEnrichmentBoundariesSubject {
  return createPaymentDraftEnrichmentBoundary();
}

describe("자동 결제 초안 기준 데이터 실패 경계 공개 계약", () => {
  it.each([
    {
      name: "기본 카테고리 없음",
      lookup: { kind: "Missing" } as const,
      expected: { kind: "Rejected", code: "DEFAULT_CATEGORY_MISSING" } as const,
    },
    {
      name: "삭제·타 가구 카테고리 참조",
      lookup: { kind: "InvalidReference" } as const,
      expected: { kind: "Rejected", code: "INVALID_CATEGORY_REFERENCE" } as const,
    },
    {
      name: "Category Repository 장애",
      lookup: { kind: "Unavailable" } as const,
      expected: {
        kind: "RetryableFailure",
        code: "CATEGORY_REPOSITORY_UNAVAILABLE",
      } as const,
    },
  ])(
    "[T-MER-ENRICH-001][ING-SAVE-002] 일반 결제의 $name은 빈 category를 만들지 않는다",
    ({ lookup, expected }) => {
      expect(
        createSubject().enrich({
          parsed: {
            sourceKind: "payment",
            merchant: "가맹점가",
            memo: "",
          },
          merchantRuleLookup: { kind: "Unmatched" },
          defaultCategoryLookup: lookup,
        }),
      ).toEqual(expected);
    },
  );

  it("[T-MER-ENRICH-001][ING-SAVE-002] Merchant Rule Port 장애는 규칙 없음으로 축약하지 않는다", () => {
    expect(
      createSubject().enrich({
        parsed: {
          sourceKind: "payment",
          merchant: "가맹점가",
          memo: "",
        },
        merchantRuleLookup: { kind: "Unavailable" },
        defaultCategoryLookup: {
          kind: "Found",
          categoryId: "category-default",
        },
      }),
    ).toEqual({
      kind: "RetryableFailure",
      code: "MERCHANT_RULES_UNAVAILABLE",
    });
  });

  it("[T-MER-ENRICH-001][ING-SAVE-002] 유효한 도시가스 parser category는 기본 카테고리 장애와 독립적으로 유지한다", () => {
    expect(
      createSubject().enrich({
        parsed: {
          sourceKind: "city-gas",
          merchant: "서울도시가스",
          categoryId: "category-utilities",
          memo: "7월 도시가스",
        },
        merchantRuleLookup: { kind: "Unmatched" },
        defaultCategoryLookup: { kind: "Unavailable" },
      }),
    ).toEqual({
      kind: "Enriched",
      draft: {
        merchant: "서울도시가스",
        categoryId: "category-utilities",
        memo: "7월 도시가스",
      },
      appliedBy: "city-gas-parser",
    });
  });
});
