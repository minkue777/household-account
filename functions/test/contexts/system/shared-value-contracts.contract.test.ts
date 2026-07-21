import { describe, expect, it } from "vitest";
import {
  createPositiveMoneyInWon,
  mapStoredCategory,
  parseLocalDate,
  parseLocalTime,
  resolveSeoulMonthBoundary,
  toStoredUtcInstant,
} from "../../../src/platform/shared-kernel/public";

type ValidationResult<T> =
  | { kind: "success"; value: T }
  | { kind: "validation-error"; code: string };

export interface SharedValueContractsSubject {
  mapStoredCategory(input: {
    storedValue?: string;
    source: "web" | "android" | "legacy";
    knownCategoryIds: readonly string[];
  }): { categoryId: string; displayState: "known" | "unknown" | "legacy-default" };
  createPositiveMoneyWon(value: unknown): ValidationResult<{ amountInWon: number }>;
  parseLocalDate(value: string): ValidationResult<{ canonical: string }>;
  parseLocalTime(value: string): ValidationResult<{ canonical: string }>;
  resolveMonthBoundary(input: {
    instant: string;
    zoneId: "Asia/Seoul";
  }): { localDate: string; yearMonth: string };
  toStoredInstant(input: {
    localDate: string;
    localTime: string;
    zoneId: "Asia/Seoul";
  }): ValidationResult<{ utcInstant: string }>;
}

export function createSubject(): SharedValueContractsSubject {
  return {
    mapStoredCategory,
    createPositiveMoneyWon: createPositiveMoneyInWon,
    parseLocalDate,
    parseLocalTime,
    resolveMonthBoundary: resolveSeoulMonthBoundary,
    toStoredInstant: toStoredUtcInstant,
  };
}

describe("공통 값 객체·호환 mapper 계약", () => {
  it.each([
    [undefined, "legacy", "etc", "legacy-default"],
    ["FOOD", "android", "food", "known"],
    ["future-category", "legacy", "future-category", "unknown"],
  ] as const)(
    "[T-SYS-003][SYS-003] category %s(%s)를 손실 없는 canonical 값으로 해석한다",
    (storedValue, source, categoryId, displayState) => {
      expect(
        createSubject().mapStoredCategory({
          storedValue,
          source,
          knownCategoryIds: ["food", "etc"],
        }),
      ).toEqual({ categoryId, displayState });
    },
  );

  it.each([1, 10_000, Number.MAX_SAFE_INTEGER])(
    "[T-SYS-004][SYS-004] 양의 safe integer %s원을 그대로 보존한다",
    (amountInWon) => {
      expect(createSubject().createPositiveMoneyWon(amountInWon)).toEqual({
        kind: "success",
        value: { amountInWon },
      });
    },
  );

  it.each([
    [0, "MONEY_MUST_BE_POSITIVE"],
    [-1, "MONEY_MUST_BE_POSITIVE"],
    [1.5, "MONEY_MUST_BE_INTEGER"],
    [Number.MAX_SAFE_INTEGER + 1, "MONEY_OUT_OF_SAFE_RANGE"],
    ["1000", "MONEY_TYPE_INVALID"],
  ])(
    "[T-SYS-004][SYS-004] 잘못된 금액 %s를 묵시적 절삭·변환 없이 거부한다",
    (value, code) => {
      expect(createSubject().createPositiveMoneyWon(value)).toEqual({
        kind: "validation-error",
        code,
      });
    },
  );

  it.each([
    ["2024-02-29", { kind: "success", value: { canonical: "2024-02-29" } }],
    ["2023-02-29", { kind: "validation-error", code: "LOCAL_DATE_INVALID" }],
    ["2026-7-01", { kind: "validation-error", code: "LOCAL_DATE_FORMAT_INVALID" }],
  ] as const)(
    "[T-SYS-005][SYS-005] LocalDate '%s'를 엄격한 YYYY-MM-DD 계약으로 검증한다",
    (value, expected) => {
      expect(createSubject().parseLocalDate(value)).toEqual(expected);
    },
  );

  it.each([
    ["00:00", { kind: "success", value: { canonical: "00:00" } }],
    ["23:59", { kind: "success", value: { canonical: "23:59" } }],
    ["24:00", { kind: "validation-error", code: "LOCAL_TIME_INVALID" }],
    ["9:05", { kind: "validation-error", code: "LOCAL_TIME_FORMAT_INVALID" }],
  ] as const)(
    "[T-SYS-005][SYS-005] LocalTime '%s'를 엄격한 HH:mm 계약으로 검증한다",
    (value, expected) => {
      expect(createSubject().parseLocalTime(value)).toEqual(expected);
    },
  );

  it("[T-SYS-005][SYS-005] UTC 월말 직후를 서버 기본 timezone이 아니라 Asia/Seoul 월 경계로 해석한다", () => {
    expect(
      createSubject().resolveMonthBoundary({
        instant: "2026-06-30T15:00:00.000Z",
        zoneId: "Asia/Seoul",
      }),
    ).toEqual({ localDate: "2026-07-01", yearMonth: "2026-07" });
  });

  it("[T-SYS-005][SYS-005] 서울 업무 시각은 날짜 경계에서 같은 순간의 UTC Instant로 변환한다", () => {
    expect(
      createSubject().toStoredInstant({
        localDate: "2026-07-01",
        localTime: "00:00",
        zoneId: "Asia/Seoul",
      }),
    ).toEqual({
      kind: "success",
      value: { utcInstant: "2026-06-30T15:00:00.000Z" },
    });
  });
});
