import { describe, expect, it } from "vitest";

import { createMerchantRuleCategoryRemapFixture } from "../../../support/merchant-rule-category-remap-fixture";

interface RemappableMerchantRule {
  ruleId: string;
  householdId: string;
  keyword: string;
  matchType: "exact" | "startsWith" | "endsWith" | "contains";
  priority?: number;
  active: boolean;
  mapping: { merchant?: string; categoryId?: string; memo?: string };
  version: number;
}

type RemapPageResult =
  | {
      kind: "PageApplied";
      processId: string;
      cursor: string | null;
      changedCount: number;
      nextCursor: string | null;
      completed: boolean;
    }
  | { kind: "RetryableFailure"; code: "PAGE_COMMIT_FAILED" };

interface MerchantRuleCategoryRemapState {
  rules: readonly RemappableMerchantRule[];
  processedPages: readonly {
    processId: string;
    cursor: string | null;
    result: Extract<RemapPageResult, { kind: "PageApplied" }>;
  }[];
}

export interface MerchantRuleCategoryRemapSubject {
  remapPage(input: {
    householdId: string;
    archivedCategoryId: string;
    defaultCategoryId: string;
    processId: string;
    cursor: string | null;
    limit: number;
    commitOutcome?: "success" | "failure";
  }): RemapPageResult;
  state(): MerchantRuleCategoryRemapState;
}

export function createSubject(fixture: {
  rules: readonly RemappableMerchantRule[];
}): MerchantRuleCategoryRemapSubject {
  return createMerchantRuleCategoryRemapFixture(fixture);
}

function rule(
  ruleId: string,
  overrides: Partial<RemappableMerchantRule> = {},
): RemappableMerchantRule {
  return {
    ruleId,
    householdId: "household-a",
    keyword: `keyword-${ruleId}`,
    matchType: "contains",
    priority: Number(ruleId.replace(/\D/g, "")) || 1,
    active: true,
    mapping: {
      merchant: `merchant-${ruleId}`,
      categoryId: "category-old",
      memo: `memo-${ruleId}`,
    },
    version: 1,
    ...overrides,
  };
}

describe("가맹점 규칙 카테고리 참조 page remap 공개 계약", () => {
  it("[T-CAT-004][MER-007] 활성·비활성 규칙을 page로 수렴시키며 category 이외 조건·mapping은 보존한다", () => {
    const original = [
      rule("rule-1"),
      rule("rule-2", { active: false }),
      rule("rule-3", {
        mapping: { categoryId: "category-other", memo: "keep-other" },
      }),
    ];
    const subject = createSubject({ rules: original });

    expect(
      subject.remapPage({
        householdId: "household-a",
        archivedCategoryId: "category-old",
        defaultCategoryId: "category-default",
        processId: "archive-category-old",
        cursor: null,
        limit: 1,
      }),
    ).toEqual({
      kind: "PageApplied",
      processId: "archive-category-old",
      cursor: null,
      changedCount: 1,
      nextCursor: "rule-1",
      completed: false,
    });
    expect(
      subject.remapPage({
        householdId: "household-a",
        archivedCategoryId: "category-old",
        defaultCategoryId: "category-default",
        processId: "archive-category-old",
        cursor: "rule-1",
        limit: 1,
      }),
    ).toEqual({
      kind: "PageApplied",
      processId: "archive-category-old",
      cursor: "rule-1",
      changedCount: 1,
      nextCursor: null,
      completed: true,
    });

    expect(subject.state().rules).toEqual([
      {
        ...original[0],
        mapping: { ...original[0].mapping, categoryId: "category-default" },
        version: 2,
      },
      {
        ...original[1],
        mapping: { ...original[1].mapping, categoryId: "category-default" },
        version: 2,
      },
      original[2],
    ]);
  });

  it("[T-CAT-004][MER-007] 같은 processId·cursor page 재요청은 저장된 결과를 재생하고 version을 다시 올리지 않는다", () => {
    const subject = createSubject({ rules: [rule("rule-1"), rule("rule-2")] });
    const input = {
      householdId: "household-a",
      archivedCategoryId: "category-old",
      defaultCategoryId: "category-default",
      processId: "archive-category-old",
      cursor: null,
      limit: 1,
    };

    const first = subject.remapPage(input);
    const afterFirst = subject.state();
    const replay = subject.remapPage(input);

    expect(replay).toEqual(first);
    expect(subject.state()).toEqual(afterFirst);
    expect(subject.state().processedPages).toHaveLength(1);
  });

  it("[T-CAT-004][MER-007] page commit 실패는 해당 page 전체를 rollback하고 같은 cursor 재시도를 허용한다", () => {
    const subject = createSubject({ rules: [rule("rule-1"), rule("rule-2")] });
    const input = {
      householdId: "household-a",
      archivedCategoryId: "category-old",
      defaultCategoryId: "category-default",
      processId: "archive-category-old",
      cursor: null,
      limit: 2,
    };
    const before = subject.state();

    expect(subject.remapPage({ ...input, commitOutcome: "failure" })).toEqual({
      kind: "RetryableFailure",
      code: "PAGE_COMMIT_FAILED",
    });
    expect(subject.state()).toEqual(before);
    expect(subject.remapPage(input)).toEqual({
      kind: "PageApplied",
      processId: "archive-category-old",
      cursor: null,
      changedCount: 2,
      nextCursor: null,
      completed: true,
    });
  });

  it("[T-CAT-004][MER-007] 타 가구 규칙과 이미 변경된 규칙은 건드리지 않고 완료한다", () => {
    const otherHousehold = rule("rule-other", { householdId: "household-b" });
    const alreadyRemapped = rule("rule-done", {
      mapping: { categoryId: "category-default", memo: "already" },
    });
    const subject = createSubject({ rules: [otherHousehold, alreadyRemapped] });
    const before = subject.state();

    expect(
      subject.remapPage({
        householdId: "household-a",
        archivedCategoryId: "category-old",
        defaultCategoryId: "category-default",
        processId: "archive-category-old",
        cursor: null,
        limit: 50,
      }),
    ).toEqual({
      kind: "PageApplied",
      processId: "archive-category-old",
      cursor: null,
      changedCount: 0,
      nextCursor: null,
      completed: true,
    });
    expect(subject.state().rules).toEqual(before.rules);
  });

  it("저장소 반환 순서와 무관하게 ruleId cursor 순서로 page를 처리한다", () => {
    const subject = createSubject({
      rules: [rule("rule-3"), rule("rule-1"), rule("rule-2")],
    });

    expect(
      subject.remapPage({
        householdId: "household-a",
        archivedCategoryId: "category-old",
        defaultCategoryId: "category-default",
        processId: "archive-unsorted",
        cursor: null,
        limit: 2,
      }),
    ).toMatchObject({ changedCount: 2, nextCursor: "rule-2", completed: false });
    expect(
      subject.remapPage({
        householdId: "household-a",
        archivedCategoryId: "category-old",
        defaultCategoryId: "category-default",
        processId: "archive-unsorted",
        cursor: "rule-2",
        limit: 2,
      }),
    ).toMatchObject({ changedCount: 1, nextCursor: null, completed: true });
    expect(
      subject.state().rules.map(({ ruleId, mapping }) => [
        ruleId,
        mapping.categoryId,
      ]),
    ).toEqual([
      ["rule-3", "category-default"],
      ["rule-1", "category-default"],
      ["rule-2", "category-default"],
    ]);
  });

  it("같은 processId·cursor 재호출은 변경된 payload보다 최초 page 결과를 우선한다", () => {
    const subject = createSubject({ rules: [rule("rule-1"), rule("rule-2")] });
    const first = subject.remapPage({
      householdId: "household-a",
      archivedCategoryId: "category-old",
      defaultCategoryId: "category-default",
      processId: "archive-stable",
      cursor: null,
      limit: 1,
    });

    expect(
      subject.remapPage({
        householdId: "household-a",
        archivedCategoryId: "category-old",
        defaultCategoryId: "category-wrong-retry",
        processId: "archive-stable",
        cursor: null,
        limit: 50,
      }),
    ).toEqual(first);
    expect(subject.state().rules[1].mapping.categoryId).toBe("category-old");
  });

  it("category mapping이 없는 규칙은 remap 대상으로 추정하지 않는다", () => {
    const withoutCategory = rule("rule-no-category", {
      mapping: { merchant: "keep", memo: "keep" },
    });
    const subject = createSubject({ rules: [withoutCategory] });

    expect(
      subject.remapPage({
        householdId: "household-a",
        archivedCategoryId: "category-old",
        defaultCategoryId: "category-default",
        processId: "archive-no-category",
        cursor: null,
        limit: 50,
      }),
    ).toMatchObject({ changedCount: 0, completed: true });
    expect(subject.state().rules).toEqual([withoutCategory]);
  });
});
