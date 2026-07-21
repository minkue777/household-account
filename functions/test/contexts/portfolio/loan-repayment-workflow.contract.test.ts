import { describe, expect, it } from "vitest";
import { createLoanRepaymentWorkflowFixture } from "../../support/loan-repayment-workflow-fixture";

type RepaymentMethod =
  | "equal-principal"
  | "equal-principal-and-interest"
  | "bullet";

interface LoanPlan {
  assetId: string;
  balance: number;
  annualInterestRate: number;
  monthlyPayment: number;
  configuredDay: number;
  repaymentMethod: RepaymentMethod;
}

type LoanEvaluation =
  | { kind: "due"; principal: number; resultingBalance: number }
  | { kind: "unsupported-method"; method: "bullet" }
  | {
      kind: "validation-error";
      code:
        | "INVALID_INTEREST_RATE"
        | "INVALID_AUTOMATION_AMOUNT"
        | "INVALID_PAYMENT_DAY";
    }
  | { kind: "already-processed"; executionId: string };

type RunRepaymentResult =
  | {
      kind: "success";
      executionId: string;
      principal: number;
      resultingBalance: number;
    }
  | { kind: "unsupported-method"; method: "bullet" }
  | { kind: "validation-error"; code: string }
  | { kind: "already-processed"; executionId: string };

interface AutomationAppliedEvent {
  eventType: "AssetAutomationApplied.v1";
  assetId: string;
  targetMonth: string;
  appliedAmount: number;
  executionId: string;
}

export interface LoanRepaymentWorkflowSubject {
  evaluate(targetMonth: string, asOfDate: string): LoanEvaluation;
  run(input: {
    targetMonth: string;
    asOfDate: string;
    idempotencyKey: string;
  }): Promise<RunRepaymentResult>;
  currentBalance(): number;
  executionIds(): readonly string[];
  recordedEvents(): readonly AutomationAppliedEvent[];
}

export function createSubject(seed: {
  plan: LoanPlan;
  existingExecution?: { targetMonth: string; executionId: string };
}): LoanRepaymentWorkflowSubject {
  return createLoanRepaymentWorkflowFixture(seed);
}

const plan = (overrides: Partial<LoanPlan> = {}): LoanPlan => ({
  assetId: "loan-1",
  balance: 100_000,
  annualInterestRate: 5,
  monthlyPayment: 10_000,
  configuredDay: 18,
  repaymentMethod: "equal-principal-and-interest",
  ...overrides,
});

describe("대출 자동 상환 평가와 월 execution 계약", () => {
  it.each([
    ["equal-principal", 10_000, 90_000],
    ["equal-principal-and-interest", 9_583, 90_417],
  ] as const)(
    "[T-LOAN-002][LOAN-002] 지원 상환 방식 %s만 due 원금을 계산해 한 execution으로 반영한다",
    async (repaymentMethod, principal, resultingBalance) => {
      const subject = createSubject({ plan: plan({ repaymentMethod }) });

      expect(subject.evaluate("2026-07", "2026-07-18")).toEqual({
        kind: "due",
        principal,
        resultingBalance,
      });
      const result = await subject.run({
        targetMonth: "2026-07",
        asOfDate: "2026-07-18",
        idempotencyKey: "run-1",
      });
      expect(result).toEqual({
        kind: "success",
        executionId: expect.any(String),
        principal,
        resultingBalance,
      });
      expect(subject.currentBalance()).toBe(resultingBalance);
      expect(subject.recordedEvents()).toEqual([
        {
          eventType: "AssetAutomationApplied.v1",
          assetId: "loan-1",
          targetMonth: "2026-07",
          appliedAmount: principal,
          executionId:
            result.kind === "success" ? result.executionId : expect.any(String),
        },
      ]);
    },
  );

  it("[T-LOAN-002][LOAN-002] 만기일시상환은 오류나 다른 공식이 아니라 unsupported 상태이며 write가 없다", async () => {
    const subject = createSubject({
      plan: plan({ repaymentMethod: "bullet" }),
    });

    expect(subject.evaluate("2026-07", "2026-07-18")).toEqual({
      kind: "unsupported-method",
      method: "bullet",
    });
    expect(
      await subject.run({
        targetMonth: "2026-07",
        asOfDate: "2026-07-18",
        idempotencyKey: "bullet",
      }),
    ).toEqual({ kind: "unsupported-method", method: "bullet" });
    expect(subject.currentBalance()).toBe(100_000);
    expect(subject.executionIds()).toEqual([]);
    expect(subject.recordedEvents()).toEqual([]);
  });

  it.each([
    [{ annualInterestRate: -1 }, "INVALID_INTEREST_RATE"],
    [{ monthlyPayment: 0 }, "INVALID_AUTOMATION_AMOUNT"],
    [{ configuredDay: 0 }, "INVALID_PAYMENT_DAY"],
    [{ configuredDay: 32 }, "INVALID_PAYMENT_DAY"],
  ] as const)(
    "[T-LOAN-002][LOAN-002] 잘못된 금리·납입액·납입일은 0으로 보정하지 않고 write 0건이다",
    async (overrides, code) => {
      const subject = createSubject({ plan: plan(overrides) });

      expect(subject.evaluate("2026-07", "2026-07-18")).toEqual({
        kind: "validation-error",
        code,
      });
      expect(
        await subject.run({
          targetMonth: "2026-07",
          asOfDate: "2026-07-18",
          idempotencyKey: "invalid",
        }),
      ).toEqual({ kind: "validation-error", code });
      expect(subject.currentBalance()).toBe(100_000);
      expect(subject.executionIds()).toEqual([]);
    },
  );

  it("[T-LOAN-002][LOAN-002] 이미 처리된 월과 동시 실행은 결정 execution claim 하나로 수렴한다", async () => {
    const subject = createSubject({ plan: plan() });
    const results = await Promise.all([
      subject.run({
        targetMonth: "2026-07",
        asOfDate: "2026-07-18",
        idempotencyKey: "concurrent-a",
      }),
      subject.run({
        targetMonth: "2026-07",
        asOfDate: "2026-07-18",
        idempotencyKey: "concurrent-b",
      }),
    ]);

    expect(results.map(({ kind }) => kind).sort()).toEqual([
      "already-processed",
      "success",
    ]);
    expect(subject.executionIds()).toHaveLength(1);
    expect(subject.currentBalance()).toBe(90_417);
    expect(subject.recordedEvents()).toHaveLength(1);
  });
});
