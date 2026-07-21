import { describe, expect, it } from "vitest";
import { createMerchantRuleSelectionPolicy } from "../../../../src/contexts/payment-capture/configuration/public";

export type MerchantMatchType =
  | "exact"
  | "startsWith"
  | "endsWith"
  | "contains";

export interface MerchantRuleFixture {
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

export type MappingDecision<TName extends string> =
  | { kind: "preserve" }
  | ({ kind: "replace" } & Record<TName, string>);

export interface MerchantMappingDecision {
  merchant: MappingDecision<"value">;
  category: MappingDecision<"categoryId">;
  memo: MappingDecision<"value">;
}

export type MerchantRuleSelectionResult =
  | {
      kind: "matched";
      ruleId: string;
      mapping: MerchantMappingDecision;
    }
  | { kind: "unmatched" }
  | { kind: "contractFailure"; code: "MERCHANT_RULE_CONFLICT" };

export interface MerchantRuleSelectionContractSubject {
  resolve(input: {
    merchant: string;
    memo: string;
    rules: readonly MerchantRuleFixture[];
  }): MerchantRuleSelectionResult;
}

export function createSubject(): MerchantRuleSelectionContractSubject {
  return createMerchantRuleSelectionPolicy();
}

function rule(
  ruleId: string,
  matchType: MerchantMatchType,
  keyword: string,
  priority?: number,
): MerchantRuleFixture {
  return {
    ruleId,
    keyword,
    matchType,
    priority,
    active: true,
    mapping: { categoryId: ruleId },
  };
}

describe("가맹점 규칙 선택 공개 계약", () => {
  it("[T-MER-001][MER-002] priority와 무관하게 exact를 가장 먼저 선택한다", () => {
    const result = createSubject().resolve({
      merchant: "Starbucks",
      memo: "",
      rules: [
        rule("contains", "contains", "arb", 1_000),
        rule("ends", "endsWith", "bucks", 900),
        rule("starts", "startsWith", "star", 800),
        rule("exact", "exact", "starbucks"),
      ],
    });

    expect(result).toMatchObject({ kind: "matched", ruleId: "exact" });
  });

  it.each([
    {
      name: "exact가 없으면 startsWith",
      rules: [
        rule("contains", "contains", "arb", 1_000),
        rule("ends", "endsWith", "bucks", 900),
        rule("starts", "startsWith", "star", 1),
      ],
      expectedRuleId: "starts",
    },
    {
      name: "exact·startsWith가 없으면 endsWith",
      rules: [
        rule("contains", "contains", "arb", 1_000),
        rule("ends", "endsWith", "bucks", 1),
      ],
      expectedRuleId: "ends",
    },
    {
      name: "더 좁은 유형이 없으면 contains",
      rules: [rule("contains", "contains", "arb", 1)],
      expectedRuleId: "contains",
    },
  ])(
    "[T-MER-001] $name 규칙을 선택한다",
    ({ rules, expectedRuleId }) => {
      const result = createSubject().resolve({
        merchant: "Starbucks",
        memo: "",
        rules,
      });

      expect(result).toMatchObject({
        kind: "matched",
        ruleId: expectedRuleId,
      });
    },
  );

  it("[T-MER-003] 쉼표 OR 키워드는 공백과 대소문자를 정규화한 뒤 하나라도 일치하면 적용한다", () => {
    const result = createSubject().resolve({
      merchant: "  COFFEE   SHOP  ",
      memo: "기존 메모",
      rules: [
        {
          ruleId: "or-rule",
          keyword: " 편의점 , coffee shop , 마트 ",
          matchType: "exact",
          active: true,
          mapping: { categoryId: "food" },
        },
      ],
    });

    expect(result).toEqual({
      kind: "matched",
      ruleId: "or-rule",
      mapping: {
        merchant: { kind: "preserve" },
        category: { kind: "replace", categoryId: "food" },
        memo: { kind: "preserve" },
      },
    });
  });

  it.each([
    ["exact", "coffee shop", "COFFEE SHOP"],
    ["startsWith", "coffee, mart", "  MART central"],
    ["endsWith", "shop, market", "local MARKET  "],
    ["contains", "fee, bakery", "Coffee Bakery"],
  ] as const)(
    "[T-MER-003][MER-001] %s도 쉼표 OR token 중 하나를 정규화된 merchant에 적용한다",
    (matchType, keyword, merchant) => {
      expect(
        createSubject().resolve({
          merchant,
          memo: "keyword와 무관한 메모",
          rules: [rule("or-rule", matchType, keyword, 10)],
        }),
      ).toMatchObject({ kind: "matched", ruleId: "or-rule" });
    },
  );

  it("[T-MER-003][MER-001] keyword는 정규화된 merchant만 매칭하며 memo 문자열은 후보를 만들지 않는다", () => {
    const result = createSubject().resolve({
      merchant: "가맹점과 무관",
      memo: "coffee shop",
      rules: [rule("memo-must-not-match", "exact", "coffee shop")],
    });

    expect(result).toEqual({ kind: "unmatched" });
  });

  it("[T-MER-003] merchant·category·memo 치환 여부를 서로 독립적으로 반환한다", () => {
    const result = createSubject().resolve({
      merchant: "효성에프엠에스",
      memo: "원래 메모",
      rules: [
        {
          ruleId: "childcare",
          keyword: "효성",
          matchType: "startsWith",
          priority: 10,
          active: true,
          mapping: {
            merchant: "어린이집 식판",
            categoryId: "childcare",
            memo: "자동 매핑",
          },
        },
      ],
    });

    expect(result).toEqual({
      kind: "matched",
      ruleId: "childcare",
      mapping: {
        merchant: { kind: "replace", value: "어린이집 식판" },
        category: { kind: "replace", categoryId: "childcare" },
        memo: { kind: "replace", value: "자동 매핑" },
      },
    });
  });

  it("[T-MER-003] 누락되거나 빈 memo mapping은 원래 memo를 보존한다", () => {
    const subject = createSubject();
    const baseInput = {
      merchant: "Coffee Shop",
      memo: "원래 메모",
    };

    const missingMemo = subject.resolve({
      ...baseInput,
      rules: [
        {
          ...rule("missing", "contains", "coffee", 2),
          mapping: { categoryId: "food" },
        },
      ],
    });
    const emptyMemo = subject.resolve({
      ...baseInput,
      rules: [
        {
          ...rule("empty", "contains", "coffee", 2),
          mapping: { categoryId: "food", memo: "" },
        },
      ],
    });

    expect(missingMemo).toMatchObject({
      kind: "matched",
      mapping: { memo: { kind: "preserve" } },
    });
    expect(emptyMemo).toMatchObject({
      kind: "matched",
      mapping: { memo: { kind: "preserve" } },
    });
  });

  it("[T-MER-005] 같은 non-exact 유형에서는 가장 높은 고유 priority 하나를 선택한다", () => {
    const result = createSubject().resolve({
      merchant: "서울 커피 전문점",
      memo: "",
      rules: [
        rule("low", "contains", "커피", 10),
        rule("high", "contains", "서울", 20),
      ],
    });

    expect(result).toMatchObject({ kind: "matched", ruleId: "high" });
  });

  it("[T-MER-005] 저장소가 규칙 순서를 바꾸어도 같은 규칙을 선택한다", () => {
    const subject = createSubject();
    const rules = [
      rule("low", "contains", "커피", 10),
      rule("high", "contains", "서울", 20),
      rule("middle", "contains", "전문점", 15),
    ];

    const forward = subject.resolve({
      merchant: "서울 커피 전문점",
      memo: "",
      rules,
    });
    const reversed = subject.resolve({
      merchant: "서울 커피 전문점",
      memo: "",
      rules: [...rules].reverse(),
    });

    expect(forward).toEqual(reversed);
    expect(forward).toMatchObject({ kind: "matched", ruleId: "high" });
  });

  it("[T-MER-005] 같은 유형·priority가 겹치면 저장 순서로 승자를 만들지 않고 계약 실패한다", () => {
    const result = createSubject().resolve({
      merchant: "서울 커피",
      memo: "",
      rules: [
        rule("first", "contains", "서울", 10),
        rule("second", "contains", "커피", 10),
      ],
    });

    expect(result).toEqual({
      kind: "contractFailure",
      code: "MERCHANT_RULE_CONFLICT",
    });
  });

  it("[T-MER-005] 비활성 규칙도 priority 유일성 충돌에는 포함하되 정상 선택 후보에서는 제외한다", () => {
    const active = rule("active", "contains", "서울", 10);
    const inactive = {
      ...rule("inactive", "contains", "커피", 10),
      active: false,
    };

    const conflicted = createSubject().resolve({
      merchant: "서울 커피",
      memo: "",
      rules: [active, inactive],
    });
    const inactiveOnly = createSubject().resolve({
      merchant: "커피",
      memo: "",
      rules: [{ ...inactive, priority: 20 }],
    });

    expect(conflicted).toEqual({
      kind: "contractFailure",
      code: "MERCHANT_RULE_CONFLICT",
    });
    expect(inactiveOnly).toEqual({ kind: "unmatched" });
  });
});
