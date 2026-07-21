import { describe, expect, it } from "vitest";

import { createMerchantRulePersistenceFixture } from "../../../support/merchant-rule-persistence-fixture";

export type MerchantMatchType =
  | "exact"
  | "startsWith"
  | "endsWith"
  | "contains";

export interface MerchantRuleView {
  ruleId: string;
  keyword: string;
  normalizedKeywords: readonly string[];
  matchType: MerchantMatchType;
  priority?: number;
  active: boolean;
  mapping: {
    merchant?: string;
    categoryId?: string;
    memo?: string;
  };
  version: number;
}

export type MerchantRulePersistenceFixture =
  | {
      ruleId: string;
      keyword: string;
      exactMatch: boolean;
      category?: string;
      active?: boolean;
    }
  | MerchantRuleView;

export interface MerchantRuleCommand {
  commandId: string;
  ruleId: string;
  keyword: string;
  matchType: MerchantMatchType;
  priority?: number;
  active: boolean;
  mapping: { categoryId?: string };
}

export type MerchantRuleWriteResult =
  | { kind: "Created" | "Updated"; rule: MerchantRuleView }
  | { kind: "Duplicate"; code: "EXACT_KEYWORD_CONFLICT" }
  | { kind: "PriorityConflict"; code: "MERCHANT_RULE_PRIORITY_CONFLICT" };

export interface MerchantRuleClaimView {
  kind: "exactKeyword" | "nonExactPriority";
  matchType: MerchantMatchType;
  value: string;
  ruleId: string;
}

export interface MerchantRulePersistenceState {
  rules: readonly MerchantRuleView[];
  claims: readonly MerchantRuleClaimView[];
}

export interface MerchantRulePersistenceContractSubject {
  read(document: MerchantRulePersistenceFixture): MerchantRuleView;
  createConcurrently(
    commands: readonly MerchantRuleCommand[],
  ): Promise<readonly MerchantRuleWriteResult[]>;
  updateConcurrently(
    commands: readonly (MerchantRuleCommand & { expectedVersion: number })[],
  ): Promise<readonly MerchantRuleWriteResult[]>;
  state(): MerchantRulePersistenceState;
}

export function createSubject(fixture?: {
  rules?: readonly MerchantRuleView[];
}): MerchantRulePersistenceContractSubject {
  return createMerchantRulePersistenceFixture(fixture);
}

const command = (
  commandId: string,
  ruleId: string,
  overrides: Partial<MerchantRuleCommand> = {},
): MerchantRuleCommand => ({
  commandId,
  ruleId,
  keyword: "coffee",
  matchType: "exact",
  active: true,
  mapping: { categoryId: "food" },
  ...overrides,
});

const currentRule = (
  ruleId: string,
  priority: number,
): MerchantRuleView => ({
  ruleId,
  keyword: ruleId,
  normalizedKeywords: [ruleId],
  matchType: "contains",
  priority,
  active: true,
  mapping: { categoryId: "food" },
  version: 1,
});

describe("가맹점 규칙 레거시 호환·유일성 claim 공개 계약", () => {
  it.each([
    {
      name: "exactMatch=true",
      fixture: {
        ruleId: "legacy-exact",
        keyword: " Coffee Shop ",
        exactMatch: true,
        category: "food",
      },
      matchType: "exact",
    },
    {
      name: "exactMatch=false",
      fixture: {
        ruleId: "legacy-contains",
        keyword: " Coffee ",
        exactMatch: false,
        category: "food",
      },
      matchType: "contains",
    },
  ] as const)(
    "[T-MER-002][MER-006] legacy $name 문서를 현재 matchType·mapping 모델로 읽는다",
    ({ fixture, matchType }) => {
      const subject = createSubject();

      const result = subject.read(fixture);

      expect(result).toMatchObject({
        ruleId: fixture.ruleId,
        normalizedKeywords: [fixture.keyword.trim().toLowerCase()],
        matchType,
        active: true,
        mapping: { categoryId: "food" },
      });
      expect(result).not.toHaveProperty("exactMatch");
      expect(result).not.toHaveProperty("category");
    },
  );

  it("[T-MER-002][MER-006] 현재 문서는 레거시 변환 없이 같은 공개 모델로 읽는다", () => {
    const subject = createSubject();
    const current = currentRule("current-rule", 10);

    expect(subject.read(current)).toEqual(current);
  });

  it("[T-MER-004][MER-004] OR 표현이 달라도 겹치는 exact token의 동시 생성은 한 규칙만 성공한다", async () => {
    const subject = createSubject();

    const results = await subject.createConcurrently([
      command("command-a", "rule-a", { keyword: "coffee, mart" }),
      command("command-b", "rule-b", { keyword: "store, COFFEE" }),
    ]);

    expect(results.map(({ kind }) => kind).sort()).toEqual([
      "Created",
      "Duplicate",
    ]);
    expect(subject.state().rules).toHaveLength(1);
    const [winner] = subject.state().rules;
    expect(subject.state().claims).toHaveLength(winner.normalizedKeywords.length);
    expect(subject.state().claims).toEqual(
      expect.arrayContaining(winner.normalizedKeywords.map((value) => ({
        kind: "exactKeyword",
        matchType: "exact",
        value,
        ruleId: winner.ruleId,
      }))),
    );
  });

  it("[T-MER-004][MER-004] 같은 non-exact 유형·priority의 동시 생성은 한 규칙과 한 claim만 남긴다", async () => {
    const subject = createSubject();

    const results = await subject.createConcurrently([
      command("command-a", "rule-a", {
        matchType: "contains",
        priority: 50,
      }),
      command("command-b", "rule-b", {
        keyword: "market",
        matchType: "contains",
        priority: 50,
      }),
    ]);

    expect(results.map(({ kind }) => kind).sort()).toEqual([
      "Created",
      "PriorityConflict",
    ]);
    expect(subject.state().rules).toHaveLength(1);
    expect(subject.state().claims).toEqual([
      {
        kind: "nonExactPriority",
        matchType: "contains",
        value: "50",
        ruleId: subject.state().rules[0].ruleId,
      },
    ]);
  });

  it("[T-MER-004][MER-004] 같은 숫자 priority라도 match type이 다르면 서로 다른 claim으로 저장한다", async () => {
    const subject = createSubject();

    const results = await subject.createConcurrently([
      command("command-a", "starts", {
        matchType: "startsWith",
        priority: 50,
      }),
      command("command-b", "contains", {
        matchType: "contains",
        priority: 50,
      }),
    ]);

    expect(results.map(({ kind }) => kind).sort()).toEqual([
      "Created",
      "Created",
    ]);
    expect(subject.state().rules).toHaveLength(2);
    expect(subject.state().claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ matchType: "startsWith", value: "50" }),
        expect.objectContaining({ matchType: "contains", value: "50" }),
      ]),
    );
  });

  it("[T-MER-004][MER-004] 두 규칙이 같은 non-exact priority로 동시에 수정돼도 loser는 원래 규칙·claim을 유지한다", async () => {
    const subject = createSubject({
      rules: [currentRule("rule-a", 10), currentRule("rule-b", 20)],
    });

    const results = await subject.updateConcurrently([
      {
        ...command("update-a", "rule-a", {
          keyword: "rule-a",
          matchType: "contains",
          priority: 30,
        }),
        expectedVersion: 1,
      },
      {
        ...command("update-b", "rule-b", {
          keyword: "rule-b",
          matchType: "contains",
          priority: 30,
        }),
        expectedVersion: 1,
      },
    ]);

    expect(results.map(({ kind }) => kind).sort()).toEqual([
      "PriorityConflict",
      "Updated",
    ]);
    const priorities = subject.state().rules.map(({ priority }) => priority);
    expect(priorities).toContain(30);
    expect(new Set(priorities).size).toBe(2);
    expect(subject.state().claims).toHaveLength(2);
    expect(new Set(subject.state().claims.map(({ value }) => value)).size).toBe(2);
  });

  it("여러 exact token 중 하나라도 기존 claim과 겹치면 새 규칙의 다른 token claim도 남기지 않는다", async () => {
    const subject = createSubject();
    await subject.createConcurrently([
      command("seed", "rule-seed", { keyword: "coffee" }),
    ]);

    expect(
      await subject.createConcurrently([
        command("conflict", "rule-conflict", { keyword: "mart, COFFEE" }),
      ]),
    ).toEqual([{ kind: "Duplicate", code: "EXACT_KEYWORD_CONFLICT" }]);
    expect(subject.state().claims.map(({ value }) => value)).toEqual(["coffee"]);
  });

  it("규칙 수정 성공은 이전 priority claim을 제거하고 새 claim만 남긴다", async () => {
    const subject = createSubject({ rules: [currentRule("rule-a", 10)] });

    expect(
      await subject.updateConcurrently([
        {
          ...command("update", "rule-a", {
            keyword: "rule-a",
            matchType: "contains",
            priority: 30,
          }),
          expectedVersion: 1,
        },
      ]),
    ).toMatchObject([{ kind: "Updated" }]);
    expect(subject.state().claims).toEqual([
      {
        kind: "nonExactPriority",
        matchType: "contains",
        value: "30",
        ruleId: "rule-a",
      },
    ]);
  });

  it("같은 commandId 재호출은 최초 결과를 재생하고 규칙·claim을 중복 생성하지 않는다", async () => {
    const subject = createSubject();
    const input = command("same-command", "rule-a");
    const first = await subject.createConcurrently([input]);
    const replay = await subject.createConcurrently([
      { ...input, ruleId: "rule-b", keyword: "different" },
    ]);

    expect(replay).toEqual(first);
    expect(subject.state().rules).toHaveLength(1);
    expect(subject.state().claims).toHaveLength(1);
  });
});
