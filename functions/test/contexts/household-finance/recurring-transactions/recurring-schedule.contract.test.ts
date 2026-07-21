import { describe, expect, it } from "vitest";
import {
  findDueRecurringMonths,
  resolveFirstApplicableMonth,
  resolveRecurringEffectiveDate,
} from "../../../../src/contexts/household-finance/recurring/public";

interface RecurringPlanSchedule {
  planId: string;
  createdOn: string;
  requestedDay: number;
  firstApplicableMonth: string;
  active: boolean;
}

export interface RecurringScheduleSubject {
  effectiveDate(targetMonth: string, requestedDay: number):
    | { kind: "success"; localDate: string }
    | { kind: "validation-error"; code: string };
  firstApplicableMonth(input: {
    createdOn: string;
    requestedDay: number;
  }):
    | { kind: "success"; yearMonth: string }
    | { kind: "validation-error"; code: string };
  dueMonths(input: {
    plan: RecurringPlanSchedule;
    asOfDate: string;
    completedMonths: readonly string[];
    limit: number;
  }):
    | {
        kind: "success";
        months: readonly string[];
        hasMore: boolean;
      }
    | { kind: "validation-error"; code: string };
}

export function createSubject(): RecurringScheduleSubject {
  return {
    effectiveDate: resolveRecurringEffectiveDate,
    firstApplicableMonth: resolveFirstApplicableMonth,
    dueMonths: findDueRecurringMonths,
  };
}

describe("정기 거래 일정 공개 계약", () => {
  it.each([
    ["2025-02", 31, "2025-02-28"],
    ["2024-02", 31, "2024-02-29"],
    ["2026-04", 31, "2026-04-30"],
    ["2026-07", 31, "2026-07-31"],
  ])(
    "[T-REC-002][REC-002] %s의 %i일을 해당 월의 유효일 %s로 보정한다",
    (targetMonth, requestedDay, localDate) => {
      expect(createSubject().effectiveDate(targetMonth, requestedDay)).toEqual({
        kind: "success",
        localDate,
      });
    },
  );

  it.each([0, 32, Number.NaN])(
    "[REC-001] 잘못된 지정일 %s을 다음 달 날짜로 넘기지 않고 거부한다",
    (requestedDay) => {
      expect(createSubject().effectiveDate("2026-07", requestedDay)).toEqual({
        kind: "validation-error",
        code: "INVALID_RECURRING_DAY",
      });
    },
  );

  it("[T-REC-004][REC-003] 생성일이 실행일 이전 또는 당일이면 생성 월부터 적용한다", () => {
    const subject = createSubject();

    expect(
      subject.firstApplicableMonth({
        createdOn: "2026-07-17",
        requestedDay: 18,
      }),
    ).toEqual({ kind: "success", yearMonth: "2026-07" });
    expect(
      subject.firstApplicableMonth({
        createdOn: "2026-07-18",
        requestedDay: 18,
      }),
    ).toEqual({ kind: "success", yearMonth: "2026-07" });
  });

  it("[T-REC-004][REC-003] 생성일이 실행일 이후면 생성 전 월을 소급하지 않고 다음 달부터 적용한다", () => {
    expect(
      createSubject().firstApplicableMonth({
        createdOn: "2026-07-19",
        requestedDay: 18,
      }),
    ).toEqual({ kind: "success", yearMonth: "2026-08" });
  });

  it("[T-REC-005][REC-003] 누락된 7·8월과 도래한 9월을 오래된 순으로 모두 반환한다", () => {
    const result = createSubject().dueMonths({
      plan: {
        planId: "plan-1",
        createdOn: "2026-07-01",
        requestedDay: 18,
        firstApplicableMonth: "2026-07",
        active: true,
      },
      asOfDate: "2026-09-18",
      completedMonths: [],
      limit: 10,
    });

    expect(result).toEqual({
      kind: "success",
      months: ["2026-07", "2026-08", "2026-09"],
      hasMore: false,
    });
  });

  it("[T-REC-005][REC-003] 이미 완료된 월은 건너뛰되 뒤의 누락 월은 계속 복구한다", () => {
    const result = createSubject().dueMonths({
      plan: {
        planId: "plan-1",
        createdOn: "2026-07-01",
        requestedDay: 18,
        firstApplicableMonth: "2026-07",
        active: true,
      },
      asOfDate: "2026-09-18",
      completedMonths: ["2026-08"],
      limit: 10,
    });

    expect(result).toEqual({
      kind: "success",
      months: ["2026-07", "2026-09"],
      hasMore: false,
    });
  });

  it("[T-REC-005][REC-003] page limit은 누락 월을 버리지 않고 후속 checkpoint가 있음을 알린다", () => {
    const result = createSubject().dueMonths({
      plan: {
        planId: "plan-1",
        createdOn: "2026-07-01",
        requestedDay: 18,
        firstApplicableMonth: "2026-07",
        active: true,
      },
      asOfDate: "2026-09-18",
      completedMonths: [],
      limit: 2,
    });

    expect(result).toEqual({
      kind: "success",
      months: ["2026-07", "2026-08"],
      hasMore: true,
    });
  });

  it("[T-REC-005][REC-002] 당월 실행일 전에는 과거 누락만 반환하고 당월은 생성하지 않는다", () => {
    const result = createSubject().dueMonths({
      plan: {
        planId: "plan-1",
        createdOn: "2026-07-01",
        requestedDay: 18,
        firstApplicableMonth: "2026-07",
        active: true,
      },
      asOfDate: "2026-09-17",
      completedMonths: [],
      limit: 10,
    });

    expect(result).toEqual({
      kind: "success",
      months: ["2026-07", "2026-08"],
      hasMore: false,
    });
  });
});
