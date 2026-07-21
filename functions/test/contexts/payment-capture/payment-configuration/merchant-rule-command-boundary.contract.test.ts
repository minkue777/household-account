import { describe, expect, it } from "vitest";

import { createMerchantRuleCommandBoundaryFixture } from "../../../support/merchant-rule-command-boundary-fixture";

type MerchantMatchType = "exact" | "startsWith" | "endsWith" | "contains";

interface MerchantRuleActor {
  householdId: string;
  memberId: string;
  capability: "paymentConfiguration:manage";
}

interface MerchantRuleRecord {
  ruleId: string;
  householdId: string;
  keyword: string;
  normalizedKeywords: readonly string[];
  matchType: MerchantMatchType;
  priority?: number;
  active: boolean;
  mapping: { merchant?: string; categoryId?: string; memo?: string };
  version: number;
}

type MerchantRuleCommandResult =
  | { kind: "Created" | "Updated"; rule: MerchantRuleRecord }
  | { kind: "Deleted"; ruleId: string }
  | {
      kind: "Reordered";
      matchType: Exclude<MerchantMatchType, "exact">;
      orderedRuleIds: readonly string[];
      collectionVersion: number;
    }
  | { kind: "NotFound" }
  | { kind: "Forbidden"; code: "HOUSEHOLD_FORBIDDEN" }
  | {
      kind: "Conflict";
      code:
        | "VERSION_MISMATCH"
        | "EXACT_KEYWORD_CONFLICT"
        | "MERCHANT_RULE_PRIORITY_CONFLICT";
    }
  | {
      kind: "Rejected";
      code:
        | "EMPTY_KEYWORD"
        | "EMPTY_OR_TOKEN"
        | "REGEX_NOT_SUPPORTED"
        | "EXACT_PRIORITY_NOT_ALLOWED"
        | "NON_EXACT_PRIORITY_REQUIRED"
        | "INCOMPLETE_RULE_SET"
        | "DUPLICATE_RULE_ID"
        | "FOREIGN_RULE_ID"
        | "MATCH_TYPE_MISMATCH";
    }
  | { kind: "RetryableFailure"; code: "ATOMIC_COMMIT_FAILED" };

interface MerchantRuleCommandState {
  rules: readonly MerchantRuleRecord[];
  exactKeywordClaims: readonly { token: string; ruleId: string }[];
  priorityClaims: readonly {
    matchType: Exclude<MerchantMatchType, "exact">;
    priority: number;
    ruleId: string;
  }[];
  collectionVersions: Readonly<Record<string, number>>;
}

export interface MerchantRuleCommandBoundarySubject {
  create(input: {
    actor: MerchantRuleActor;
    ruleId: string;
    keyword: string;
    matchType: MerchantMatchType | "regex";
    priority?: number;
    mapping: MerchantRuleRecord["mapping"];
    active: boolean;
    commitOutcome?: "success" | "failure";
  }): MerchantRuleCommandResult;
  update(input: {
    actor: MerchantRuleActor;
    ruleId: string;
    expectedVersion: number;
    keyword: string;
    matchType: MerchantMatchType;
    priority?: number;
    mapping: MerchantRuleRecord["mapping"];
    active: boolean;
    commitOutcome?: "success" | "failure";
  }): MerchantRuleCommandResult;
  delete(input: {
    actor: MerchantRuleActor;
    ruleId: string;
    expectedVersion: number;
    commitOutcome?: "success" | "failure";
  }): MerchantRuleCommandResult;
  reorder(input: {
    actor: MerchantRuleActor;
    matchType: Exclude<MerchantMatchType, "exact">;
    orderedRuleIds: readonly string[];
    expectedCollectionVersion: number;
    commitOutcome?: "success" | "failure";
  }): MerchantRuleCommandResult;
  state(): MerchantRuleCommandState;
}

export function createSubject(fixture?: {
  rules?: readonly MerchantRuleRecord[];
  collectionVersions?: Readonly<Record<string, number>>;
}): MerchantRuleCommandBoundarySubject {
  return createMerchantRuleCommandBoundaryFixture(fixture);
}

const actor: MerchantRuleActor = {
  householdId: "household-a",
  memberId: "member-a",
  capability: "paymentConfiguration:manage",
};

function rule(
  ruleId: string,
  priority: number,
  overrides: Partial<MerchantRuleRecord> = {},
): MerchantRuleRecord {
  return {
    ruleId,
    householdId: "household-a",
    keyword: ruleId,
    normalizedKeywords: [ruleId],
    matchType: "contains",
    priority,
    active: true,
    mapping: { categoryId: "category-a", memo: "memo-a" },
    version: 1,
    ...overrides,
  };
}

describe("가맹점 규칙 Command·claim·원자 재정렬 공개 계약", () => {
  it("[T-MER-004][MER-001/MER-004] exact 생성은 OR token을 공백·대소문자 기준으로 정규화하고 같은 규칙 안의 중복 token claim은 하나만 만든다", () => {
    const subject = createSubject();

    const created = subject.create({
      actor,
      ruleId: "rule-exact-new",
      keyword: " Coffee   Shop, MART, coffee shop ",
      matchType: "exact",
      mapping: { categoryId: "category-a" },
      active: true,
    });
    expect(created).toMatchObject({
      kind: "Created",
      rule: {
        householdId: "household-a",
        normalizedKeywords: ["coffee shop", "mart"],
        matchType: "exact",
        version: 1,
      },
    });
    if (created.kind === "Created") {
      expect(
        Object.prototype.hasOwnProperty.call(created.rule, "priority"),
      ).toBe(false);
    }
    expect(subject.state().exactKeywordClaims).toEqual([
      { token: "coffee shop", ruleId: "rule-exact-new" },
      { token: "mart", ruleId: "rule-exact-new" },
    ]);
    expect(subject.state().priorityClaims).toEqual([]);
  });

  it("[T-MER-004][MER-004] 전체 표현이 달라도 정규화 exact OR token 하나가 겹치면 loser는 claim·본문을 전혀 남기지 않는다", () => {
    const original = rule("rule-exact-existing", 0, {
      keyword: "coffee, mart",
      normalizedKeywords: ["coffee", "mart"],
      matchType: "exact",
      priority: undefined,
    });
    const subject = createSubject({ rules: [original] });
    const before = subject.state();

    expect(
      subject.create({
        actor,
        ruleId: "rule-exact-loser",
        keyword: "bakery, COFFEE",
        matchType: "exact",
        mapping: { categoryId: "category-b" },
        active: true,
      }),
    ).toEqual({ kind: "Conflict", code: "EXACT_KEYWORD_CONFLICT" });
    expect(subject.state()).toEqual(before);
  });

  it("[T-MER-004][MER-002/MER-004] exact 규칙에는 숫자 priority를 저장하지 않는다", () => {
    const subject = createSubject();

    expect(
      subject.create({
        actor,
        ruleId: "rule-exact-with-priority",
        keyword: "coffee",
        matchType: "exact",
        priority: 100,
        mapping: {},
        active: true,
      }),
    ).toEqual({ kind: "Rejected", code: "EXACT_PRIORITY_NOT_ALLOWED" });
    expect(subject.state().rules).toEqual([]);
  });

  it.each([
    { label: "누락", priority: undefined },
    { label: "0", priority: 0 },
    { label: "음수", priority: -1 },
    { label: "소수", priority: 1.5 },
    { label: "NaN", priority: Number.NaN },
    { label: "Infinity", priority: Number.POSITIVE_INFINITY },
    { label: "안전 정수 초과", priority: Number.MAX_SAFE_INTEGER + 1 },
  ])(
    "[T-MER-004][MER-004] non-exact priority $label 값은 양의 안전 정수가 아니므로 write 0건이다",
    ({ priority }) => {
      const subject = createSubject();

      expect(
        subject.create({
          actor,
          ruleId: "rule-invalid-priority",
          keyword: "coffee",
          matchType: "contains",
          priority,
          mapping: {},
          active: true,
        }),
      ).toEqual({
        kind: "Rejected",
        code: "NON_EXACT_PRIORITY_REQUIRED",
      });
      expect(subject.state()).toEqual({
        rules: [],
        exactKeywordClaims: [],
        priorityClaims: [],
        collectionVersions: {},
      });
    },
  );

  it("[T-MER-004/T-MER-005][MER-004] non-exact keyword는 겹칠 수 있지만 같은 match type의 priority claim은 하나만 성공한다", () => {
    const subject = createSubject();
    const createContains = (ruleId: string, keyword: string, priority: number) =>
      subject.create({
        actor,
        ruleId,
        keyword,
        matchType: "contains",
        priority,
        mapping: {},
        active: true,
      });

    expect(createContains("rule-low", "coffee", 10)).toMatchObject({
      kind: "Created",
    });
    expect(createContains("rule-high", "coffee", 20)).toMatchObject({
      kind: "Created",
    });
    const beforeConflict = subject.state();
    expect(createContains("rule-priority-loser", "mart", 20)).toEqual({
      kind: "Conflict",
      code: "MERCHANT_RULE_PRIORITY_CONFLICT",
    });
    expect(subject.state()).toEqual(beforeConflict);
  });

  it("[T-MER-004][MER-004] 같은 숫자 priority도 match type이 다르면 서로 다른 claim으로 생성할 수 있다", () => {
    const subject = createSubject();

    for (const [ruleId, matchType] of [
      ["rule-starts", "startsWith"],
      ["rule-contains", "contains"],
    ] as const) {
      expect(
        subject.create({
          actor,
          ruleId,
          keyword: "coffee",
          matchType,
          priority: 10,
          mapping: {},
          active: true,
        }),
      ).toMatchObject({ kind: "Created" });
    }
    expect(subject.state().priorityClaims).toEqual([
      { matchType: "startsWith", priority: 10, ruleId: "rule-starts" },
      { matchType: "contains", priority: 10, ruleId: "rule-contains" },
    ]);
  });

  it.each([
    {
      label: "타 가구 actor",
      requestActor: { ...actor, householdId: "household-b" },
    },
    {
      label: "관리 capability가 없는 actor",
      requestActor: {
        ...actor,
        capability: "paymentConfiguration:read",
      } as unknown as MerchantRuleActor,
    },
  ])(
    "[T-MER-004][MER-004] $label는 새 규칙과 claim을 만들 수 없다",
    ({ requestActor }) => {
      const subject = createSubject();

      expect(
        subject.create({
          actor: requestActor,
          ruleId: "rule-forbidden",
          keyword: "coffee",
          matchType: "exact",
          mapping: {},
          active: true,
        }),
      ).toEqual({ kind: "Forbidden", code: "HOUSEHOLD_FORBIDDEN" });
      expect(subject.state().rules).toEqual([]);
      expect(subject.state().exactKeywordClaims).toEqual([]);
    },
  );

  it("[T-MER-004][MER-004] 생성 transaction commit 실패는 규칙·claim·collection version을 모두 rollback한다", () => {
    const subject = createSubject();
    const before = subject.state();

    expect(
      subject.create({
        actor,
        ruleId: "rule-create-failure",
        keyword: "coffee",
        matchType: "contains",
        priority: 10,
        mapping: {},
        active: true,
        commitOutcome: "failure",
      }),
    ).toEqual({ kind: "RetryableFailure", code: "ATOMIC_COMMIT_FAILED" });
    expect(subject.state()).toEqual(before);
  });

  it("[T-MER-004][MER-004] 이미 존재하는 rule ID로 새 claim을 덮어쓰지 않는다", () => {
    const original = rule("rule-existing", 10);
    const subject = createSubject({ rules: [original] });
    const before = subject.state();

    expect(
      subject.create({
        actor,
        ruleId: original.ruleId,
        keyword: "different",
        matchType: "contains",
        priority: 20,
        mapping: {},
        active: true,
      }),
    ).toEqual({ kind: "Rejected", code: "DUPLICATE_RULE_ID" });
    expect(subject.state()).toEqual(before);
  });

  it.each([
    { keyword: "", code: "EMPTY_KEYWORD" as const },
    { keyword: "coffee, ,mart", code: "EMPTY_OR_TOKEN" as const },
  ])(
    "[T-MER-004][MER-001][MER-004] keyword '$keyword'는 $code로 거부하고 claim을 만들지 않는다",
    ({ keyword, code }) => {
      const subject = createSubject();

      expect(
        subject.create({
          actor,
          ruleId: "rule-invalid",
          keyword,
          matchType: "exact",
          mapping: { categoryId: "category-a" },
          active: true,
        }),
      ).toEqual({ kind: "Rejected", code });
      expect(subject.state().rules).toEqual([]);
      expect(subject.state().exactKeywordClaims).toEqual([]);
    },
  );

  it("[T-MER-002][MER-006] regex 요청은 조용히 변환하지 않고 명시적으로 거부한다", () => {
    const subject = createSubject();

    expect(
      subject.create({
        actor,
        ruleId: "rule-regex",
        keyword: "^coffee.*",
        matchType: "regex",
        mapping: { categoryId: "category-a" },
        active: true,
      }),
    ).toEqual({ kind: "Rejected", code: "REGEX_NOT_SUPPORTED" });
    expect(subject.state().rules).toEqual([]);
  });

  it("[T-MER-004][MER-004] exact keyword 수정은 새 token claim과 본문을 확정한 뒤 이전 claim을 같은 UoW에서 해제한다", () => {
    const original = rule("rule-exact", 0, {
      keyword: "coffee, mart",
      normalizedKeywords: ["coffee", "mart"],
      matchType: "exact",
      priority: undefined,
    });
    const subject = createSubject({ rules: [original] });

    expect(
      subject.update({
        actor,
        ruleId: original.ruleId,
        expectedVersion: 1,
        keyword: "cafe, bakery",
        matchType: "exact",
        mapping: { categoryId: "category-b" },
        active: true,
      }),
    ).toMatchObject({
      kind: "Updated",
      rule: {
        normalizedKeywords: ["cafe", "bakery"],
        version: 2,
      },
    });
    expect(subject.state().exactKeywordClaims).toEqual(
      expect.arrayContaining([
        { token: "cafe", ruleId: "rule-exact" },
        { token: "bakery", ruleId: "rule-exact" },
      ]),
    );
    expect(subject.state().exactKeywordClaims).not.toEqual(
      expect.arrayContaining([
        { token: "coffee", ruleId: "rule-exact" },
        { token: "mart", ruleId: "rule-exact" },
      ]),
    );
  });

  it.each([
    {
      name: "stale version",
      expectedVersion: 0,
      commitOutcome: "success" as const,
      expected: { kind: "Conflict", code: "VERSION_MISMATCH" } as const,
    },
    {
      name: "commit 실패",
      expectedVersion: 1,
      commitOutcome: "failure" as const,
      expected: { kind: "RetryableFailure", code: "ATOMIC_COMMIT_FAILED" } as const,
    },
  ])(
    "[T-MER-004][MER-004] exact claim 교체의 $name은 규칙·이전 claim을 원상 유지한다",
    ({ expectedVersion, commitOutcome, expected }) => {
      const original = rule("rule-exact", 0, {
        keyword: "coffee",
        normalizedKeywords: ["coffee"],
        matchType: "exact",
        priority: undefined,
      });
      const subject = createSubject({ rules: [original] });
      const before = subject.state();

      expect(
        subject.update({
          actor,
          ruleId: original.ruleId,
          expectedVersion,
          keyword: "cafe",
          matchType: "exact",
          mapping: { categoryId: "category-b" },
          active: true,
          commitOutcome,
        }),
      ).toEqual(expected);
      expect(subject.state()).toEqual(before);
    },
  );

  it("[T-MER-004][MER-004] update가 같은 유형의 기존 priority를 요구하면 기존 규칙·두 claim을 모두 유지한다", () => {
    const low = rule("rule-low", 10);
    const high = rule("rule-high", 20);
    const subject = createSubject({ rules: [low, high] });
    const before = subject.state();

    expect(
      subject.update({
        actor,
        ruleId: low.ruleId,
        expectedVersion: low.version,
        keyword: "changed",
        matchType: "contains",
        priority: 20,
        mapping: {},
        active: true,
      }),
    ).toEqual({
      kind: "Conflict",
      code: "MERCHANT_RULE_PRIORITY_CONFLICT",
    });
    expect(subject.state()).toEqual(before);
  });

  it("[T-MER-004][MER-004] non-exact에서 exact로 바꾸면 이전 priority claim을 해제하고 새 token claim과 collection version을 함께 확정한다", () => {
    const original = rule("rule-changing-type", 10, {
      keyword: "coffee",
      normalizedKeywords: ["coffee"],
    });
    const subject = createSubject({
      rules: [original],
      collectionVersions: { "household-a:contains": 3 },
    });

    const updated = subject.update({
      actor,
      ruleId: original.ruleId,
      expectedVersion: original.version,
      keyword: " Cafe, BAKERY ",
      matchType: "exact",
      mapping: { categoryId: "category-b" },
      active: false,
    });
    expect(updated).toMatchObject({
      kind: "Updated",
      rule: {
        matchType: "exact",
        normalizedKeywords: ["cafe", "bakery"],
        version: 2,
      },
    });
    if (updated.kind === "Updated") {
      expect(
        Object.prototype.hasOwnProperty.call(updated.rule, "priority"),
      ).toBe(false);
    }
    expect(subject.state().priorityClaims).toEqual([]);
    expect(subject.state().exactKeywordClaims).toEqual([
      { token: "cafe", ruleId: original.ruleId },
      { token: "bakery", ruleId: original.ruleId },
    ]);
    expect(subject.state().collectionVersions).toEqual({
      "household-a:contains": 4,
    });
  });

  it("[T-MER-004][MER-004] 삭제 성공은 exact token claim을 원자 해제하여 새 규칙이 같은 token을 다시 점유할 수 있게 한다", () => {
    const original = rule("rule-exact-delete", 0, {
      keyword: "coffee",
      normalizedKeywords: ["coffee"],
      matchType: "exact",
      priority: undefined,
    });
    const subject = createSubject({ rules: [original] });

    expect(
      subject.delete({
        actor,
        ruleId: original.ruleId,
        expectedVersion: original.version,
      }),
    ).toEqual({ kind: "Deleted", ruleId: original.ruleId });
    expect(subject.state().exactKeywordClaims).toEqual([]);
    expect(
      subject.create({
        actor,
        ruleId: "rule-exact-replacement",
        keyword: "COFFEE",
        matchType: "exact",
        mapping: {},
        active: true,
      }),
    ).toMatchObject({ kind: "Created" });
    expect(subject.state().exactKeywordClaims).toEqual([
      { token: "coffee", ruleId: "rule-exact-replacement" },
    ]);
  });

  it.each([
    {
      label: "stale version",
      expectedVersion: 0,
      commitOutcome: "success" as const,
      expected: { kind: "Conflict", code: "VERSION_MISMATCH" } as const,
    },
    {
      label: "commit 실패",
      expectedVersion: 1,
      commitOutcome: "failure" as const,
      expected: {
        kind: "RetryableFailure",
        code: "ATOMIC_COMMIT_FAILED",
      } as const,
    },
  ])(
    "[T-MER-004][MER-004] 삭제 $label는 규칙과 claim을 원상 유지한다",
    ({ expectedVersion, commitOutcome, expected }) => {
      const original = rule("rule-delete", 10);
      const subject = createSubject({ rules: [original] });
      const before = subject.state();

      expect(
        subject.delete({
          actor,
          ruleId: original.ruleId,
          expectedVersion,
          commitOutcome,
        }),
      ).toEqual(expected);
      expect(subject.state()).toEqual(before);
    },
  );

  it.each(["update", "delete"] as const)(
    "[T-MER-004][MER-004] 존재하지 않는 규칙 $s는 NotFound와 write 0건이다",
    (operation) => {
      const subject = createSubject();
      const result =
        operation === "update"
          ? subject.update({
              actor,
              ruleId: "missing",
              expectedVersion: 1,
              keyword: "coffee",
              matchType: "exact",
              mapping: {},
              active: true,
            })
          : subject.delete({ actor, ruleId: "missing", expectedVersion: 1 });

      expect(result).toEqual({ kind: "NotFound" });
      expect(subject.state().rules).toEqual([]);
    },
  );

  it("[T-MER-005][MER-004] 한 유형의 활성·비활성 전체 규칙을 받아 고유 priority로 원자 재번호한다", () => {
    const rules = [
      rule("rule-a", 10),
      rule("rule-b", 20, { active: false }),
      rule("rule-c", 30),
    ];
    const subject = createSubject({
      rules,
      collectionVersions: { "household-a:contains": 4 },
    });

    expect(
      subject.reorder({
        actor,
        matchType: "contains",
        orderedRuleIds: ["rule-a", "rule-c", "rule-b"],
        expectedCollectionVersion: 4,
      }),
    ).toEqual({
      kind: "Reordered",
      matchType: "contains",
      orderedRuleIds: ["rule-a", "rule-c", "rule-b"],
      collectionVersion: 5,
    });
    expect(
      subject.state().rules
        .filter(({ matchType }) => matchType === "contains")
        .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0))
        .map(({ ruleId, priority, active }) => ({ ruleId, priority, active })),
    ).toEqual([
      { ruleId: "rule-a", priority: 30, active: true },
      { ruleId: "rule-c", priority: 20, active: true },
      { ruleId: "rule-b", priority: 10, active: false },
    ]);
    expect(new Set(subject.state().priorityClaims.map(({ priority }) => priority)).size)
      .toBe(3);
  });

  it.each([
    {
      name: "비활성 ID 누락",
      orderedRuleIds: ["rule-a", "rule-c"],
      expected: { kind: "Rejected", code: "INCOMPLETE_RULE_SET" } as const,
    },
    {
      name: "중복 ID",
      orderedRuleIds: ["rule-a", "rule-a", "rule-b"],
      expected: { kind: "Rejected", code: "DUPLICATE_RULE_ID" } as const,
    },
    {
      name: "타 가구 ID",
      orderedRuleIds: ["rule-a", "rule-b", "rule-foreign"],
      expected: { kind: "Rejected", code: "FOREIGN_RULE_ID" } as const,
    },
    {
      name: "다른 match type ID",
      orderedRuleIds: ["rule-a", "rule-b", "rule-starts"],
      expected: { kind: "Rejected", code: "MATCH_TYPE_MISMATCH" } as const,
    },
  ])(
    "[T-MER-005][MER-004] 재정렬 $name은 중간 동률·부분 저장 없이 거부한다",
    ({ orderedRuleIds, expected }) => {
      const rules = [
        rule("rule-a", 10),
        rule("rule-b", 20, { active: false }),
        rule("rule-c", 30),
        rule("rule-foreign", 40, { householdId: "household-b" }),
        rule("rule-starts", 50, { matchType: "startsWith" }),
      ];
      const subject = createSubject({
        rules,
        collectionVersions: { "household-a:contains": 4 },
      });
      const before = subject.state();

      expect(
        subject.reorder({
          actor,
          matchType: "contains",
          orderedRuleIds,
          expectedCollectionVersion: 4,
        }),
      ).toEqual(expected);
      expect(subject.state()).toEqual(before);
    },
  );

  it.each([
    {
      name: "stale collection version",
      expectedCollectionVersion: 3,
      commitOutcome: "success" as const,
      expected: { kind: "Conflict", code: "VERSION_MISMATCH" } as const,
    },
    {
      name: "중간 commit 실패",
      expectedCollectionVersion: 4,
      commitOutcome: "failure" as const,
      expected: { kind: "RetryableFailure", code: "ATOMIC_COMMIT_FAILED" } as const,
    },
  ])(
    "[T-MER-005][MER-004] $name은 모든 priority·claim·collection version을 rollback한다",
    ({ expectedCollectionVersion, commitOutcome, expected }) => {
      const subject = createSubject({
        rules: [rule("rule-a", 10), rule("rule-b", 20)],
        collectionVersions: { "household-a:contains": 4 },
      });
      const before = subject.state();

      expect(
        subject.reorder({
          actor,
          matchType: "contains",
          orderedRuleIds: ["rule-a", "rule-b"],
          expectedCollectionVersion,
          commitOutcome,
        }),
      ).toEqual(expected);
      expect(subject.state()).toEqual(before);
    },
  );

  it("[T-MER-004][MER-004] 타 가구 actor는 규칙 ID를 알아도 update·delete·reorder를 실행할 수 없다", () => {
    const original = rule("rule-a", 10);
    const subject = createSubject({
      rules: [original],
      collectionVersions: { "household-a:contains": 1 },
    });
    const foreignActor = { ...actor, householdId: "household-b" };
    const before = subject.state();

    expect(
      subject.update({
        actor: foreignActor,
        ruleId: "rule-a",
        expectedVersion: 1,
        keyword: "changed",
        matchType: "contains",
        priority: 10,
        mapping: {},
        active: true,
      }),
    ).toEqual({ kind: "Forbidden", code: "HOUSEHOLD_FORBIDDEN" });
    expect(
      subject.delete({ actor: foreignActor, ruleId: "rule-a", expectedVersion: 1 }),
    ).toEqual({ kind: "Forbidden", code: "HOUSEHOLD_FORBIDDEN" });
    expect(
      subject.reorder({
        actor: foreignActor,
        matchType: "contains",
        orderedRuleIds: ["rule-a"],
        expectedCollectionVersion: 1,
      }),
    ).toEqual({ kind: "Forbidden", code: "HOUSEHOLD_FORBIDDEN" });
    expect(subject.state()).toEqual(before);
  });
});
