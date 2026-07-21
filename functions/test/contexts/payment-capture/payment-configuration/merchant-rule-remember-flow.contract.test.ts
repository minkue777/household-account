import { describe, expect, it } from "vitest";

import { createRememberMerchantRuleFixture } from "../../../support/remember-merchant-rule-fixture";

export interface RememberMerchantRuleInput {
  householdId: string;
  transactionId: string;
  transactionType: "expense" | "income";
  merchant: string;
  categoryId: string;
  rememberForNextTime: boolean;
}

export type RememberMerchantRuleResult =
  | { kind: "ExpenseUpdatedAndRuleCreated"; ruleId: string }
  | { kind: "ExpenseUpdatedWithoutRule" }
  | { kind: "RuleAlreadyExists"; ruleId: string }
  | { kind: "Rejected"; code: "REMEMBER_NOT_AVAILABLE_FOR_INCOME" };

export interface RememberMerchantRuleSnapshot {
  transactions: readonly {
    transactionId: string;
    categoryId: string;
  }[];
  rules: readonly {
    ruleId: string;
    householdId: string;
    matchType: "exact";
    keyword: string;
    categoryId: string;
  }[];
}

export interface RememberMerchantRuleContractSubject {
  save(input: RememberMerchantRuleInput): Promise<RememberMerchantRuleResult>;
  snapshot(): RememberMerchantRuleSnapshot;
}

export function createSubject(): RememberMerchantRuleContractSubject {
  return createRememberMerchantRuleFixture();
}

const expenseInput: RememberMerchantRuleInput = {
  householdId: "household-1",
  transactionId: "transaction-1",
  transactionType: "expense",
  merchant: "  스타벅스 강남점  ",
  categoryId: "category-cafe",
  rememberForNextTime: true,
};

describe("지출 수정 시 가맹점 규칙 기억 공개 계약", () => {
  it("[T-MER-006][MER-005] 지출에서 기억을 선택하면 카테고리 수정과 정규화 exact 규칙을 함께 확정한다", async () => {
    const subject = createSubject();

    const result = await subject.save(expenseInput);

    expect(result).toMatchObject({
      kind: "ExpenseUpdatedAndRuleCreated",
      ruleId: expect.any(String),
    });
    expect(subject.snapshot()).toEqual({
      transactions: [
        { transactionId: "transaction-1", categoryId: "category-cafe" },
      ],
      rules: [
        {
          ruleId: expect.any(String),
          householdId: "household-1",
          matchType: "exact",
          keyword: "스타벅스 강남점",
          categoryId: "category-cafe",
        },
      ],
    });
  });

  it("[T-MER-006][MER-005] 기억을 선택하지 않은 지출 수정은 규칙을 만들지 않는다", async () => {
    const subject = createSubject();

    expect(
      await subject.save({ ...expenseInput, rememberForNextTime: false }),
    ).toEqual({ kind: "ExpenseUpdatedWithoutRule" });
    expect(subject.snapshot().rules).toEqual([]);
    expect(subject.snapshot().transactions).toEqual([
      { transactionId: "transaction-1", categoryId: "category-cafe" },
    ]);
  });

  it("[T-MER-006][MER-005] 수입에는 기억 선택을 제공하지 않고 입력돼도 거래·규칙을 바꾸지 않는다", async () => {
    const subject = createSubject();

    expect(
      await subject.save({ ...expenseInput, transactionType: "income" }),
    ).toEqual({
      kind: "Rejected",
      code: "REMEMBER_NOT_AVAILABLE_FOR_INCOME",
    });
    expect(subject.snapshot()).toEqual({ transactions: [], rules: [] });
  });

  it("[T-MER-006][MER-005] 같은 가구의 동일 정규 exact 규칙이 있으면 중복 규칙을 만들지 않고 기존 규칙을 반환한다", async () => {
    const subject = createSubject();

    const first = await subject.save(expenseInput);
    const second = await subject.save({
      ...expenseInput,
      transactionId: "transaction-2",
      merchant: "스타벅스 강남점",
    });

    expect(first).toMatchObject({ kind: "ExpenseUpdatedAndRuleCreated" });
    expect(second).toMatchObject({
      kind: "RuleAlreadyExists",
      ruleId: expect.any(String),
    });
    expect(subject.snapshot().transactions).toHaveLength(2);
    expect(subject.snapshot().rules).toHaveLength(1);
  });

  it("같은 keyword라도 다른 가구면 별도의 exact 규칙을 만든다", async () => {
    const subject = createSubject();
    await subject.save(expenseInput);

    expect(
      await subject.save({
        ...expenseInput,
        householdId: "household-2",
        transactionId: "transaction-2",
      }),
    ).toMatchObject({ kind: "ExpenseUpdatedAndRuleCreated" });
    expect(subject.snapshot().rules).toHaveLength(2);
  });

  it("공백과 영문 대소문자가 다른 merchant도 같은 canonical exact 규칙으로 본다", async () => {
    const subject = createSubject();
    await subject.save({ ...expenseInput, merchant: " Coffee   LAB " });

    expect(
      await subject.save({
        ...expenseInput,
        transactionId: "transaction-2",
        merchant: "coffee lab",
      }),
    ).toMatchObject({ kind: "RuleAlreadyExists" });
    expect(subject.snapshot().rules).toHaveLength(1);
  });

  it("같은 거래를 다시 저장해도 거래 snapshot을 중복 추가하지 않는다", async () => {
    const subject = createSubject();
    await subject.save({ ...expenseInput, rememberForNextTime: false });
    await subject.save({
      ...expenseInput,
      categoryId: "category-lunch",
      rememberForNextTime: false,
    });

    expect(subject.snapshot().transactions).toEqual([
      { transactionId: "transaction-1", categoryId: "category-lunch" },
    ]);
  });

  it("수입은 remember flag가 false여도 이 지출 전용 use case에서 수정하지 않는다", async () => {
    const subject = createSubject();

    expect(
      await subject.save({
        ...expenseInput,
        transactionType: "income",
        rememberForNextTime: false,
      }),
    ).toEqual({
      kind: "Rejected",
      code: "REMEMBER_NOT_AVAILABLE_FOR_INCOME",
    });
    expect(subject.snapshot()).toEqual({ transactions: [], rules: [] });
  });
});
