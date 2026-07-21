import { describe, expect, it } from "vitest";
import { createLedgerPeriodTestSubject } from "../../../support/ledger-read-subject";

export interface LedgerPeriodRow {
  transactionId: string;
  householdId: string;
  transactionType?: "expense" | "income";
  lifecycleState: "active" | "superseded" | "deleted";
  accountingDate: string;
  localTime: string;
  amountInWon: number;
}

export type LedgerPeriodQueryResult =
  | {
      kind: "Success";
      items: readonly {
        transactionId: string;
        accountingDate: string;
        localTime: string;
        amountInWon: number;
      }[];
    }
  | { kind: "NoData" }
  | { kind: "RetryableFailure"; code: string };

export interface LedgerPeriodQueryContractSubject {
  byMonth(input: {
    householdId: string;
    transactionType: "expense" | "income";
    yearMonth: string;
  }): Promise<LedgerPeriodQueryResult>;
  byPeriod(input: {
    householdId: string;
    transactionType: "expense" | "income";
    startDate: string;
    endDate: string;
  }): Promise<LedgerPeriodQueryResult>;
}

export function createSubject(fixture: {
  rows?: readonly LedgerPeriodRow[];
  failureCode?: string;
}): LedgerPeriodQueryContractSubject {
  return createLedgerPeriodTestSubject(fixture);
}

function row(
  transactionId: string,
  accountingDate: string,
  overrides: Partial<LedgerPeriodRow> = {},
): LedgerPeriodRow {
  return {
    transactionId,
    householdId: "household-1",
    transactionType: "expense",
    lifecycleState: "active",
    accountingDate,
    localTime: "12:00",
    amountInWon: 10_000,
    ...overrides,
  };
}

describe("Ledger 월·기간 조회 공개 계약", () => {
  it("[T-LED-001][LED-001] 월 조회는 해당 달의 active 거래만 날짜·시각·ID 내림차순으로 반환한다", async () => {
    const subject = createSubject({
      rows: [
        row("june", "2026-06-30"),
        row("july-start", "2026-07-01", { localTime: "00:00" }),
        row("same-a", "2026-07-31", { localTime: "23:59" }),
        row("same-c", "2026-07-31", { localTime: "23:59" }),
        row("income", "2026-07-20", { transactionType: "income" }),
        row("superseded", "2026-07-20", {
          lifecycleState: "superseded",
        }),
      ],
    });

    const result = await subject.byMonth({
      householdId: "household-1",
      transactionType: "expense",
      yearMonth: "2026-07",
    });

    expect(result).toMatchObject({
      kind: "Success",
      items: [
        { transactionId: "same-c" },
        { transactionId: "same-a" },
        { transactionId: "july-start" },
      ],
    });
  });

  it("[T-LED-001][LED-001] 기간 조회는 시작일과 종료일을 모두 포함하고 가구·유형 경계를 지킨다", async () => {
    const subject = createSubject({
      rows: [
        row("before", "2026-07-09"),
        row("start", "2026-07-10"),
        row("middle", "2026-07-15"),
        row("end", "2026-07-20"),
        row("after", "2026-07-21"),
        row("other-house", "2026-07-15", { householdId: "household-2" }),
        row("legacy-expense", "2026-07-14", { transactionType: undefined }),
      ],
    });

    const result = await subject.byPeriod({
      householdId: "household-1",
      transactionType: "expense",
      startDate: "2026-07-10",
      endDate: "2026-07-20",
    });

    expect(result).toMatchObject({
      kind: "Success",
      items: [
        { transactionId: "end" },
        { transactionId: "middle" },
        { transactionId: "legacy-expense" },
        { transactionId: "start" },
      ],
    });
  });

  it("[T-LED-001][LED-001] 일치 거래가 없으면 성공 빈 배열과 구분되는 NoData를 반환한다", async () => {
    expect(
      await createSubject({ rows: [] }).byMonth({
        householdId: "household-1",
        transactionType: "expense",
        yearMonth: "2026-07",
      }),
    ).toEqual({ kind: "NoData" });
  });

  it("[T-LED-001][LED-001] 구독 원천 실패를 빈 월로 축약하지 않는다", async () => {
    expect(
      await createSubject({
        failureCode: "LEDGER_SUBSCRIPTION_UNAVAILABLE",
      }).byMonth({
        householdId: "household-1",
        transactionType: "expense",
        yearMonth: "2026-07",
      }),
    ).toEqual({
      kind: "RetryableFailure",
      code: "LEDGER_SUBSCRIPTION_UNAVAILABLE",
    });
  });
});
