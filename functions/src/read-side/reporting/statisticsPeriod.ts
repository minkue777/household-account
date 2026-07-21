export type StatisticsPeriodPreset =
  | "LAST_3_MONTHS"
  | "LAST_6_MONTHS"
  | "LAST_12_MONTHS"
  | "CUSTOM";

export interface StatisticsPeriodInput {
  preset: StatisticsPeriodPreset;
  now: string;
  zoneId: "Asia/Seoul";
  customRange?: { startDate?: string; endDate?: string };
}

export interface ResolvedStatisticsPeriod {
  startDate: string;
  endDate: string;
  resolvedFrom: StatisticsPeriodPreset | "LAST_12_MONTHS_FALLBACK";
}

export type ResolveStatisticsPeriodResult =
  | { kind: "success"; value: ResolvedStatisticsPeriod }
  | { kind: "validation-error"; code: "INVALID_PERIOD_ORDER" };

interface YearMonth {
  year: number;
  month: number;
}

function currentYearMonth(now: string): YearMonth {
  const instant = new Date(now);
  if (Number.isNaN(instant.getTime())) {
    throw new Error("유효한 현재 시각이 필요합니다.");
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
  }).formatToParts(instant);

  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  return { year, month };
}

function shiftMonths(value: YearMonth, amount: number): YearMonth {
  const zeroBased = value.year * 12 + value.month - 1 + amount;
  return {
    year: Math.floor(zeroBased / 12),
    month: (zeroBased % 12) + 1,
  };
}

function parseYearMonth(date: string): YearMonth {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(date);
  if (match === null) throw new Error("YYYY-MM-DD 날짜가 필요합니다.");
  return { year: Number(match[1]), month: Number(match[2]) };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function firstDay(value: YearMonth): string {
  return `${String(value.year).padStart(4, "0")}-${pad(value.month)}-01`;
}

function lastDay(value: YearMonth): string {
  const day = new Date(Date.UTC(value.year, value.month, 0)).getUTCDate();
  return `${String(value.year).padStart(4, "0")}-${pad(value.month)}-${pad(day)}`;
}

function compare(left: YearMonth, right: YearMonth): number {
  return left.year * 12 + left.month - (right.year * 12 + right.month);
}

function rollingPeriod(
  now: YearMonth,
  months: number,
  resolvedFrom: ResolvedStatisticsPeriod["resolvedFrom"],
): ResolveStatisticsPeriodResult {
  return {
    kind: "success",
    value: {
      startDate: firstDay(shiftMonths(now, -(months - 1))),
      endDate: lastDay(now),
      resolvedFrom,
    },
  };
}

export function resolveStatisticsPeriod(
  input: StatisticsPeriodInput,
): ResolveStatisticsPeriodResult {
  const now = currentYearMonth(input.now);
  const rollingMonths = {
    LAST_3_MONTHS: 3,
    LAST_6_MONTHS: 6,
    LAST_12_MONTHS: 12,
  } as const;

  if (input.preset !== "CUSTOM") {
    return rollingPeriod(now, rollingMonths[input.preset], input.preset);
  }

  const startDate = input.customRange?.startDate;
  const endDate = input.customRange?.endDate;
  if (startDate === undefined || endDate === undefined) {
    return rollingPeriod(now, 12, "LAST_12_MONTHS_FALLBACK");
  }

  const start = parseYearMonth(startDate);
  const end = parseYearMonth(endDate);
  if (compare(start, end) > 0) {
    return { kind: "validation-error", code: "INVALID_PERIOD_ORDER" };
  }

  return {
    kind: "success",
    value: {
      startDate: firstDay(start),
      endDate: lastDay(end),
      resolvedFrom: "CUSTOM",
    },
  };
}
