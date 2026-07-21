import { describe, expect, it } from "vitest";
import { splitMonthly } from "../../../../src/contexts/household-finance/ledger/public";

export interface MonthlySplitInput {
  amountInWon: number;
  startDate: string;
  months: number;
}

export interface MonthlyInstallment {
  sequence: number;
  total: number;
  amountInWon: number;
  accountingDate: string;
}

export type MonthlySplitResult =
  | {
      kind: "success";
      installments: readonly MonthlyInstallment[];
    }
  | {
      kind: "validationError";
      code:
        | "AMOUNT_NOT_POSITIVE_INTEGER"
        | "MONTHS_BELOW_TWO"
        | "INVALID_ACCOUNTING_DATE";
    };

export interface MonthlySplitContractSubject {
  split(input: MonthlySplitInput): MonthlySplitResult;
}

export function createSubject(): MonthlySplitContractSubject {
  return { split: splitMonthly };
}

describe("월 분할 공개 계약", () => {
  it("[T-SPL-001][SPL-002/SPL-005] 원금을 개월 수로 내림한 같은 금액을 저장하고 나머지 1원은 반영하지 않는다", () => {
    const result = createSubject().split({
      amountInWon: 10_000,
      startDate: "2026-01-15",
      months: 3,
    });

    expect(result).toEqual({
      kind: "success",
      installments: [
        {
          sequence: 1,
          total: 3,
          amountInWon: 3_333,
          accountingDate: "2026-01-15",
        },
        {
          sequence: 2,
          total: 3,
          amountInWon: 3_333,
          accountingDate: "2026-02-15",
        },
        {
          sequence: 3,
          total: 3,
          amountInWon: 3_333,
          accountingDate: "2026-03-15",
        },
      ],
    });

    if (result.kind === "success") {
      expect(
        result.installments.reduce(
          (sum, installment) => sum + installment.amountInWon,
          0,
        ),
      ).toBe(9_999);
    }
  });

  it("[T-SPL-001] 나머지가 없을 때도 모든 회차에 동일한 금액을 저장한다", () => {
    const result = createSubject().split({
      amountInWon: 9_000,
      startDate: "2026-05-10",
      months: 3,
    });

    expect(result).toEqual({
      kind: "success",
      installments: [
        {
          sequence: 1,
          total: 3,
          amountInWon: 3_000,
          accountingDate: "2026-05-10",
        },
        {
          sequence: 2,
          total: 3,
          amountInWon: 3_000,
          accountingDate: "2026-06-10",
        },
        {
          sequence: 3,
          total: 3,
          amountInWon: 3_000,
          accountingDate: "2026-07-10",
        },
      ],
    });
  });

  it.each([
    {
      name: "평년 1월 31일",
      startDate: "2026-01-31",
      expectedDates: ["2026-01-31", "2026-02-28", "2026-03-31"],
    },
    {
      name: "윤년 1월 31일",
      startDate: "2024-01-31",
      expectedDates: ["2024-01-31", "2024-02-29", "2024-03-31"],
    },
    {
      name: "8월 31일",
      startDate: "2026-08-31",
      expectedDates: ["2026-08-31", "2026-09-30", "2026-10-31"],
    },
  ])(
    "[T-SPL-002][SPL-002] $name은 각 대상 월의 마지막 유효일로만 보정한다",
    ({ startDate, expectedDates }) => {
      const result = createSubject().split({
        amountInWon: 12_000,
        startDate,
        months: 3,
      });

      expect(result.kind).toBe("success");
      if (result.kind === "success") {
        expect(
          result.installments.map((installment) => installment.accountingDate),
        ).toEqual(expectedDates);
      }
    },
  );

  it("[T-SPL-002] 30일 시작일은 2월만 말일로 보정하고 다음 달에는 원래 일자를 다시 사용한다", () => {
    const result = createSubject().split({
      amountInWon: 12_000,
      startDate: "2026-01-30",
      months: 3,
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(
        result.installments.map((installment) => installment.accountingDate),
      ).toEqual(["2026-01-30", "2026-02-28", "2026-03-30"]);
    }
  });

  it("[T-SPL-002] 최소 허용값인 2개월은 두 회차만 만든다", () => {
    const result = createSubject().split({
      amountInWon: 10_000,
      startDate: "2026-07-19",
      months: 2,
    });

    expect(result).toEqual({
      kind: "success",
      installments: [
        {
          sequence: 1,
          total: 2,
          amountInWon: 5_000,
          accountingDate: "2026-07-19",
        },
        {
          sequence: 2,
          total: 2,
          amountInWon: 5_000,
          accountingDate: "2026-08-19",
        },
      ],
    });
  });

  it("[T-SPL-002] 1개월 요청은 거래를 만들지 않고 안정적인 검증 오류를 반환한다", () => {
    const result = createSubject().split({
      amountInWon: 10_000,
      startDate: "2026-07-19",
      months: 1,
    });

    expect(result).toEqual({
      kind: "validationError",
      code: "MONTHS_BELOW_TWO",
    });
  });
});
