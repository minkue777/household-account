import { describe, expect, it } from "vitest";

import { createMerchantRuleLegacyAdapterFixture } from "../../../support/merchant-rule-legacy-adapter-fixture";

type LegacyMerchantRuleReadResult =
  | {
      kind: "Read";
      rule: {
        ruleId: string;
        normalizedKeywords: readonly string[];
        matchType: "exact" | "contains";
        priority?: number;
        active: boolean;
        mapping: { categoryId?: string };
      };
    }
  | {
      kind: "ContractFailure";
      code:
        | "EMPTY_KEYWORD"
        | "INVALID_CATEGORY_REFERENCE"
        | "INVALID_PRIORITY"
        | "REGEX_NOT_SUPPORTED";
    };

export interface MerchantRuleLegacyAdapterBoundariesSubject {
  read(document: Readonly<Record<string, unknown>>): LegacyMerchantRuleReadResult;
}

export function createSubject(): MerchantRuleLegacyAdapterBoundariesSubject {
  return createMerchantRuleLegacyAdapterFixture();
}

describe("가맹점 규칙 legacy adapter 유효성 공개 계약", () => {
  it("[T-MER-002][MER-006] legacy active=false를 기본 true로 덮지 않고 비활성 상태로 읽는다", () => {
    expect(
      createSubject().read({
        ruleId: "legacy-inactive",
        keyword: " Coffee ",
        exactMatch: false,
        category: "category-cafe",
        active: false,
      }),
    ).toEqual({
      kind: "Read",
      rule: {
        ruleId: "legacy-inactive",
        normalizedKeywords: ["coffee"],
        matchType: "contains",
        active: false,
        mapping: { categoryId: "category-cafe" },
      },
    });
  });

  it.each([
    {
      name: "빈 keyword",
      document: { ruleId: "bad-keyword", keyword: "  ", exactMatch: true },
      code: "EMPTY_KEYWORD" as const,
    },
    {
      name: "비문자 category",
      document: {
        ruleId: "bad-category",
        keyword: "coffee",
        exactMatch: true,
        category: 42,
      },
      code: "INVALID_CATEGORY_REFERENCE" as const,
    },
    {
      name: "비정수 priority",
      document: {
        ruleId: "bad-priority",
        keyword: "coffee",
        matchType: "contains",
        priority: 1.5,
      },
      code: "INVALID_PRIORITY" as const,
    },
    {
      name: "regex 유형",
      document: {
        ruleId: "bad-regex",
        keyword: "^coffee",
        matchType: "regex",
        priority: 1,
      },
      code: "REGEX_NOT_SUPPORTED" as const,
    },
  ])(
    "[T-MER-002][MER-006] $name 문서는 임의 보정하지 않고 $code를 반환한다",
    ({ document, code }) => {
      expect(createSubject().read(document)).toEqual({
        kind: "ContractFailure",
        code,
      });
    },
  );

  it("legacy active가 없으면 기존 기본값인 활성 상태로 읽고 exactMatch를 현재 유형으로 변환한다", () => {
    expect(
      createSubject().read({
        ruleId: "legacy-exact",
        keyword: "  편의점  ",
        exactMatch: true,
      }),
    ).toEqual({
      kind: "Read",
      rule: {
        ruleId: "legacy-exact",
        normalizedKeywords: ["편의점"],
        matchType: "exact",
        active: true,
        mapping: {},
      },
    });
  });

  it("쉼표 keyword의 각 token을 공백·대소문자와 무관한 canonical 값으로 읽는다", () => {
    expect(
      createSubject().read({
        ruleId: "legacy-multiple",
        keyword: " Coffee Shop,  COFFEE   LAB ",
        exactMatch: false,
        priority: 2,
      }),
    ).toMatchObject({
      kind: "Read",
      rule: {
        normalizedKeywords: ["coffee shop", "coffee lab"],
        matchType: "contains",
        priority: 2,
      },
    });
  });

  it("빈 category reference는 유효한 미지정 값으로 보정하지 않는다", () => {
    expect(
      createSubject().read({
        ruleId: "legacy-empty-category",
        keyword: "coffee",
        category: "  ",
      }),
    ).toEqual({
      kind: "ContractFailure",
      code: "INVALID_CATEGORY_REFERENCE",
    });
  });

  it.each([0, -1])("0 이하 priority %s는 유효한 순서로 보정하지 않는다", (priority) => {
    expect(
      createSubject().read({
        ruleId: "legacy-invalid-priority",
        keyword: "coffee",
        matchType: "contains",
        priority,
      }),
    ).toEqual({ kind: "ContractFailure", code: "INVALID_PRIORITY" });
  });
});
