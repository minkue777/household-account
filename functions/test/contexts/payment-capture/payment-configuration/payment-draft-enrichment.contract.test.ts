import { describe, expect, it } from "vitest";
import { createPaymentDraftEnrichmentPolicy } from "../../../../src/contexts/payment-capture/configuration/public";

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

export interface PaymentDraftEnrichmentContractSubject {
  enrich(input: PaymentDraftEnrichmentInput): EnrichedPaymentDraft;
}

export function createSubject(): PaymentDraftEnrichmentContractSubject {
  return createPaymentDraftEnrichmentPolicy();
}

describe("자동 결제 초안의 가맹점 규칙·기본 카테고리 적용 공개 계약", () => {
  it("[T-MER-ENRICH-001][ING-SAVE-002/MER-001/MER-003] 일치 규칙이 있으면 도시가스를 포함해 parser·기본값보다 먼저 독립 mapping을 적용한다", () => {
    expect(
      createSubject().enrich({
        originalMerchant: "서울도시가스",
        parsedCategoryId: "category-utilities",
        parsedMemo: "7월 도시가스",
        sourceKind: "city-gas",
        householdDefaultCategoryId: "category-etc",
        matchedRule: {
          merchant: "가스요금",
          categoryId: "category-home",
          memo: "자동 납부",
        },
      }),
    ).toEqual({
      merchant: "가스요금",
      categoryId: "category-home",
      memo: "자동 납부",
      appliedBy: "merchant-rule",
    });
  });

  it("[T-MER-ENRICH-001][ING-SAVE-002] 규칙 없는 도시가스는 parser가 정한 카테고리와 memo를 유지한다", () => {
    expect(
      createSubject().enrich({
        originalMerchant: "서울도시가스",
        parsedCategoryId: "category-utilities",
        parsedMemo: "7월 도시가스",
        sourceKind: "city-gas",
        householdDefaultCategoryId: "category-etc",
      }),
    ).toEqual({
      merchant: "서울도시가스",
      categoryId: "category-utilities",
      memo: "7월 도시가스",
      appliedBy: "city-gas-parser",
    });
  });

  it("[T-MER-ENRICH-001][ING-SAVE-002] 규칙 없는 일반 결제는 가구 기본 카테고리와 parser 가맹점·memo를 사용한다", () => {
    expect(
      createSubject().enrich({
        originalMerchant: "편의점",
        parsedMemo: "일시불",
        sourceKind: "payment",
        householdDefaultCategoryId: "category-etc",
      }),
    ).toEqual({
      merchant: "편의점",
      categoryId: "category-etc",
      memo: "일시불",
      appliedBy: "household-default",
    });
  });

  it("[T-MER-ENRICH-001][ING-SAVE-002/MER-003] 규칙의 빈 memo는 parser memo를 지우지 않는다", () => {
    expect(
      createSubject().enrich({
        originalMerchant: "카페",
        parsedMemo: "승인",
        sourceKind: "payment",
        householdDefaultCategoryId: "category-etc",
        matchedRule: { categoryId: "category-cafe", memo: "" },
      }),
    ).toEqual({
      merchant: "카페",
      categoryId: "category-cafe",
      memo: "승인",
      appliedBy: "merchant-rule",
    });
  });
});
