import { describe, expect, it } from "vitest";
import { resolveStatisticsPeriod } from "../../../../src/read-side/reporting/public";

type ExpensePeriodPreset =
  | "LAST_3_MONTHS"
  | "LAST_6_MONTHS"
  | "LAST_12_MONTHS"
  | "CUSTOM";

interface StatisticsPeriod {
  startDate: string;
  endDate: string;
  resolvedFrom: ExpensePeriodPreset | "LAST_12_MONTHS_FALLBACK";
}

type ResolveStatisticsPeriodResult =
  | { kind: "success"; value: StatisticsPeriod }
  | { kind: "validation-error"; code: "INVALID_PERIOD_ORDER" };

export interface StatisticsPeriodSubject {
  resolve(input: {
    preset: ExpensePeriodPreset;
    now: string;
    zoneId: "Asia/Seoul";
    customRange?: { startDate?: string; endDate?: string };
  }): ResolveStatisticsPeriodResult;
}

export function createSubject(): StatisticsPeriodSubject {
  return { resolve: resolveStatisticsPeriod };
}

describe("Reporting 지출 통계 기간 공개 계약", () => {
  it.each([
    ["LAST_3_MONTHS", "2026-05-01", "2026-07-31"],
    ["LAST_6_MONTHS", "2026-02-01", "2026-07-31"],
    ["LAST_12_MONTHS", "2025-08-01", "2026-07-31"],
  ] as const)(
    "[T-STAT-PERIOD-001][STAT-001] %s는 현재 월을 포함하는 완전한 월 경계로 계산한다",
    (preset, startDate, endDate) => {
      const result = createSubject().resolve({
        preset,
        now: "2026-07-19T12:34:56+09:00",
        zoneId: "Asia/Seoul",
      });

      expect(result).toEqual({
        kind: "success",
        value: { startDate, endDate, resolvedFrom: preset },
      });
    },
  );

  it("[T-STAT-PERIOD-002][STAT-001] 사용자 지정 날짜는 각각 시작 월 1일과 종료 월 말일로 정규화한다", () => {
    const result = createSubject().resolve({
      preset: "CUSTOM",
      now: "2026-07-19T12:34:56+09:00",
      zoneId: "Asia/Seoul",
      customRange: {
        startDate: "2024-02-29",
        endDate: "2024-04-03",
      },
    });

    expect(result).toEqual({
      kind: "success",
      value: {
        startDate: "2024-02-01",
        endDate: "2024-04-30",
        resolvedFrom: "CUSTOM",
      },
    });
  });

  it.each([
    { startDate: "2026-01-01" },
    { endDate: "2026-06-30" },
    {},
  ])(
    "[T-STAT-PERIOD-003][STAT-001] 불완전한 사용자 지정 범위 %#는 최근 12개월로 대체한다",
    (customRange) => {
      const result = createSubject().resolve({
        preset: "CUSTOM",
        now: "2026-07-19T12:34:56+09:00",
        zoneId: "Asia/Seoul",
        customRange,
      });

      expect(result).toEqual({
        kind: "success",
        value: {
          startDate: "2025-08-01",
          endDate: "2026-07-31",
          resolvedFrom: "LAST_12_MONTHS_FALLBACK",
        },
      });
    },
  );

  it("[T-STAT-PERIOD-004][STAT-001] 시작 월이 종료 월보다 늦으면 조용히 뒤집지 않고 거부한다", () => {
    const result = createSubject().resolve({
      preset: "CUSTOM",
      now: "2026-07-19T12:34:56+09:00",
      zoneId: "Asia/Seoul",
      customRange: {
        startDate: "2026-07-01",
        endDate: "2026-06-30",
      },
    });

    expect(result).toEqual({
      kind: "validation-error",
      code: "INVALID_PERIOD_ORDER",
    });
  });

  it("[T-STAT-PERIOD-005][STAT-001/DEC-023] UTC 날짜가 아니라 Asia/Seoul의 현재 월을 기준으로 계산한다", () => {
    const result = createSubject().resolve({
      preset: "LAST_3_MONTHS",
      now: "2026-07-31T15:30:00.000Z",
      zoneId: "Asia/Seoul",
    });

    expect(result).toEqual({
      kind: "success",
      value: {
        startDate: "2026-06-01",
        endDate: "2026-08-31",
        resolvedFrom: "LAST_3_MONTHS",
      },
    });
  });
});
