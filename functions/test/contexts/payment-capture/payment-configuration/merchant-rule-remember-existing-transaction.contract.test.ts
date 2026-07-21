import { describe, expect, it } from "vitest";

import { createRememberExistingTransactionFixture } from "../../../support/remember-existing-transaction-fixture";

interface EditableTransaction {
  transactionId: string;
  householdId: string;
  transactionType: "expense" | "income";
  merchant: string;
  categoryId: string;
  version: number;
}

interface RememberedExactRule {
  ruleId: string;
  householdId: string;
  normalizedKeyword: string;
  categoryId: string;
}

type RememberExistingTransactionResult =
  | {
      kind: "UpdatedAndRuleCreated" | "UpdatedAndExistingRuleReused";
      transactionId: string;
      transactionVersion: number;
      ruleId: string;
    }
  | { kind: "UpdatedWithoutRule"; transactionId: string; transactionVersion: number }
  | { kind: "NotFound" }
  | { kind: "Forbidden"; code: "HOUSEHOLD_FORBIDDEN" }
  | { kind: "Conflict"; code: "TRANSACTION_VERSION_MISMATCH" }
  | { kind: "Rejected"; code: "REMEMBER_NOT_AVAILABLE_FOR_INCOME" }
  | { kind: "RetryableFailure"; code: "ATOMIC_COMMIT_FAILED" };

interface RememberExistingTransactionState {
  transactions: readonly EditableTransaction[];
  rules: readonly RememberedExactRule[];
  exactClaims: readonly { normalizedKeyword: string; ruleId: string }[];
}

export interface RememberExistingTransactionSubject {
  update(input: {
    actor: { householdId: string; memberId: string };
    transactionId: string;
    expectedVersion: number;
    categoryId: string;
    rememberForNextTime: boolean;
    commitOutcome?: "success" | "failure";
  }): RememberExistingTransactionResult;
  state(): RememberExistingTransactionState;
}

export function createSubject(fixture: {
  transactions: readonly EditableTransaction[];
  rules?: readonly RememberedExactRule[];
}): RememberExistingTransactionSubject {
  return createRememberExistingTransactionFixture(fixture);
}

const expense: EditableTransaction = {
  transactionId: "expense-a",
  householdId: "household-a",
  transactionType: "expense",
  merchant: "  스타벅스 강남점  ",
  categoryId: "category-old",
  version: 3,
};

describe("기존 지출 수정과 가맹점 규칙 기억의 원자 계약", () => {
  it("[T-MER-006][MER-005] 존재하는 지출 version을 갱신하고 정규 merchant exact 규칙·claim을 같은 UoW에 만든다", () => {
    const subject = createSubject({ transactions: [expense] });

    const result = subject.update({
      actor: { householdId: "household-a", memberId: "member-a" },
      transactionId: "expense-a",
      expectedVersion: 3,
      categoryId: "category-cafe",
      rememberForNextTime: true,
    });

    expect(result).toEqual({
      kind: "UpdatedAndRuleCreated",
      transactionId: "expense-a",
      transactionVersion: 4,
      ruleId: expect.any(String),
    });
    if (result.kind !== "UpdatedAndRuleCreated") {
      throw new Error("UpdatedAndRuleCreated 결과가 필요합니다.");
    }
    expect(subject.state()).toEqual({
      transactions: [{ ...expense, categoryId: "category-cafe", version: 4 }],
      rules: [
        {
          ruleId: result.ruleId,
          householdId: "household-a",
          normalizedKeyword: "스타벅스 강남점",
          categoryId: "category-cafe",
        },
      ],
      exactClaims: [
        {
          normalizedKeyword: "스타벅스 강남점",
          ruleId: result.ruleId,
        },
      ],
    });
  });

  it("[T-MER-006][MER-005] 같은 exact rule이 있으면 새 규칙 없이 기존 rule을 재사용하며 지출은 갱신한다", () => {
    const existingRule: RememberedExactRule = {
      ruleId: "rule-existing",
      householdId: "household-a",
      normalizedKeyword: "스타벅스 강남점",
      categoryId: "category-cafe",
    };
    const subject = createSubject({
      transactions: [expense],
      rules: [existingRule],
    });

    expect(
      subject.update({
        actor: { householdId: "household-a", memberId: "member-a" },
        transactionId: "expense-a",
        expectedVersion: 3,
        categoryId: "category-cafe",
        rememberForNextTime: true,
      }),
    ).toEqual({
      kind: "UpdatedAndExistingRuleReused",
      transactionId: "expense-a",
      transactionVersion: 4,
      ruleId: "rule-existing",
    });
    expect(subject.state().rules).toEqual([existingRule]);
    expect(subject.state().transactions).toEqual([
      { ...expense, categoryId: "category-cafe", version: 4 },
    ]);
  });

  it.each([
    {
      name: "타 가구 actor",
      actorHouseholdId: "household-b",
      expectedVersion: 3,
      commitOutcome: "success" as const,
      expected: { kind: "Forbidden", code: "HOUSEHOLD_FORBIDDEN" } as const,
    },
    {
      name: "stale version",
      actorHouseholdId: "household-a",
      expectedVersion: 2,
      commitOutcome: "success" as const,
      expected: { kind: "Conflict", code: "TRANSACTION_VERSION_MISMATCH" } as const,
    },
    {
      name: "commit 실패",
      actorHouseholdId: "household-a",
      expectedVersion: 3,
      commitOutcome: "failure" as const,
      expected: { kind: "RetryableFailure", code: "ATOMIC_COMMIT_FAILED" } as const,
    },
  ])(
    "[T-MER-006][MER-005] $name은 지출·규칙·claim을 모두 원상 유지한다",
    ({ actorHouseholdId, expectedVersion, commitOutcome, expected }) => {
      const subject = createSubject({ transactions: [expense] });
      const before = subject.state();

      expect(
        subject.update({
          actor: { householdId: actorHouseholdId, memberId: "member-a" },
          transactionId: "expense-a",
          expectedVersion,
          categoryId: "category-cafe",
          rememberForNextTime: true,
          commitOutcome,
        }),
      ).toEqual(expected);
      expect(subject.state()).toEqual(before);
    },
  );

  it("[T-MER-006][MER-005] 수입은 기억 입력을 거부하고 기존 거래도 변경하지 않는다", () => {
    const income = { ...expense, transactionType: "income" as const };
    const subject = createSubject({ transactions: [income] });
    const before = subject.state();

    expect(
      subject.update({
        actor: { householdId: "household-a", memberId: "member-a" },
        transactionId: "expense-a",
        expectedVersion: 3,
        categoryId: "category-income",
        rememberForNextTime: true,
      }),
    ).toEqual({
      kind: "Rejected",
      code: "REMEMBER_NOT_AVAILABLE_FOR_INCOME",
    });
    expect(subject.state()).toEqual(before);
  });

  it("존재하지 않는 거래는 규칙이나 claim을 만들지 않고 NotFound를 반환한다", () => {
    const subject = createSubject({ transactions: [expense] });
    const before = subject.state();

    expect(
      subject.update({
        actor: { householdId: "household-a", memberId: "member-a" },
        transactionId: "missing",
        expectedVersion: 1,
        categoryId: "category-cafe",
        rememberForNextTime: true,
      }),
    ).toEqual({ kind: "NotFound" });
    expect(subject.state()).toEqual(before);
  });

  it("기억하지 않는 지출 수정은 version만 한 번 올리고 규칙·claim을 만들지 않는다", () => {
    const subject = createSubject({ transactions: [expense] });

    expect(
      subject.update({
        actor: { householdId: "household-a", memberId: "member-a" },
        transactionId: "expense-a",
        expectedVersion: 3,
        categoryId: "category-cafe",
        rememberForNextTime: false,
      }),
    ).toEqual({
      kind: "UpdatedWithoutRule",
      transactionId: "expense-a",
      transactionVersion: 4,
    });
    expect(subject.state()).toEqual({
      transactions: [{ ...expense, categoryId: "category-cafe", version: 4 }],
      rules: [],
      exactClaims: [],
    });
  });

  it("기억하지 않는 수입의 일반 카테고리 수정은 허용한다", () => {
    const income = { ...expense, transactionType: "income" as const };
    const subject = createSubject({ transactions: [income] });

    expect(
      subject.update({
        actor: { householdId: "household-a", memberId: "member-a" },
        transactionId: "expense-a",
        expectedVersion: 3,
        categoryId: "category-income",
        rememberForNextTime: false,
      }),
    ).toMatchObject({ kind: "UpdatedWithoutRule", transactionVersion: 4 });
  });

  it("다른 가구의 같은 keyword 규칙은 현재 가구의 exact claim을 대신하지 않는다", () => {
    const subject = createSubject({
      transactions: [expense],
      rules: [
        {
          ruleId: "rule-other-household",
          householdId: "household-b",
          normalizedKeyword: "스타벅스 강남점",
          categoryId: "category-other",
        },
      ],
    });

    const result = subject.update({
      actor: { householdId: "household-a", memberId: "member-a" },
      transactionId: "expense-a",
      expectedVersion: 3,
      categoryId: "category-cafe",
      rememberForNextTime: true,
    });

    expect(result).toMatchObject({ kind: "UpdatedAndRuleCreated" });
    expect(subject.state().rules).toHaveLength(2);
  });
});
