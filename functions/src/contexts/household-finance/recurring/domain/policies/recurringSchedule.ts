export interface RecurringPlanSchedule {
  planId: string;
  createdOn: string;
  requestedDay: number;
  firstApplicableMonth: string;
  active: boolean;
}

export type RecurringScheduleResult<T> =
  | { kind: "success" } & T
  | { kind: "validation-error"; code: string };

interface YearMonth {
  year: number;
  month: number;
}

const DAY_IN_MILLISECONDS = 86_400_000;

export function isValidRecurringRequestedDay(requestedDay: number): boolean {
  return (
    Number.isInteger(requestedDay) && requestedDay >= 1 && requestedDay <= 31
  );
}

function parseYearMonth(value: string): YearMonth | undefined {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (match === null) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return undefined;
  return { year, month };
}

function parseLocalDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const result = new Date(Date.UTC(year, month - 1, day));
  if (
    result.getUTCFullYear() !== year ||
    result.getUTCMonth() !== month - 1 ||
    result.getUTCDate() !== day
  ) {
    return undefined;
  }
  return result;
}

function formatYearMonth(value: YearMonth): string {
  return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}`;
}

function shiftMonth(value: YearMonth, amount: number): YearMonth {
  const zeroBased = value.year * 12 + value.month - 1 + amount;
  return {
    year: Math.floor(zeroBased / 12),
    month: (zeroBased % 12) + 1,
  };
}

function compareMonth(left: YearMonth, right: YearMonth): number {
  return left.year * 12 + left.month - (right.year * 12 + right.month);
}

function monthEndDay(value: YearMonth): number {
  return new Date(Date.UTC(value.year, value.month, 0)).getUTCDate();
}

function formatLocalDate(value: YearMonth, day: number): string {
  return `${formatYearMonth(value)}-${String(day).padStart(2, "0")}`;
}

export function resolveRecurringEffectiveDate(
  targetMonth: string,
  requestedDay: number,
): RecurringScheduleResult<{ localDate: string }> {
  if (!isValidRecurringRequestedDay(requestedDay)) {
    return { kind: "validation-error", code: "INVALID_RECURRING_DAY" };
  }
  const month = parseYearMonth(targetMonth);
  if (month === undefined) {
    return { kind: "validation-error", code: "INVALID_YEAR_MONTH" };
  }
  return {
    kind: "success",
    localDate: formatLocalDate(month, Math.min(requestedDay, monthEndDay(month))),
  };
}

export function resolveFirstApplicableMonth(input: {
  createdOn: string;
  requestedDay: number;
}): RecurringScheduleResult<{ yearMonth: string }> {
  const createdOn = parseLocalDate(input.createdOn);
  if (createdOn === undefined) {
    return { kind: "validation-error", code: "INVALID_LOCAL_DATE" };
  }
  if (!isValidRecurringRequestedDay(input.requestedDay)) {
    return { kind: "validation-error", code: "INVALID_RECURRING_DAY" };
  }

  const createdMonth = {
    year: createdOn.getUTCFullYear(),
    month: createdOn.getUTCMonth() + 1,
  };
  const effectiveDay = Math.min(
    input.requestedDay,
    monthEndDay(createdMonth),
  );
  const firstMonth =
    createdOn.getUTCDate() <= effectiveDay
      ? createdMonth
      : shiftMonth(createdMonth, 1);
  return { kind: "success", yearMonth: formatYearMonth(firstMonth) };
}

export function findDueRecurringMonths(input: {
  plan: RecurringPlanSchedule;
  asOfDate: string;
  completedMonths: readonly string[];
  limit: number;
}): RecurringScheduleResult<{ months: readonly string[]; hasMore: boolean }> {
  if (!isValidRecurringRequestedDay(input.plan.requestedDay)) {
    return { kind: "validation-error", code: "INVALID_RECURRING_DAY" };
  }
  if (!Number.isInteger(input.limit) || input.limit <= 0) {
    return { kind: "validation-error", code: "INVALID_PAGE_LIMIT" };
  }
  const first = parseYearMonth(input.plan.firstApplicableMonth);
  const asOfDate = parseLocalDate(input.asOfDate);
  if (first === undefined || asOfDate === undefined) {
    return { kind: "validation-error", code: "INVALID_SCHEDULE_DATE" };
  }
  if (!input.plan.active) {
    return { kind: "success", months: [], hasMore: false };
  }

  const asOfMonth: YearMonth = {
    year: asOfDate.getUTCFullYear(),
    month: asOfDate.getUTCMonth() + 1,
  };
  const currentEffectiveDate = resolveRecurringEffectiveDate(
    formatYearMonth(asOfMonth),
    input.plan.requestedDay,
  );
  if (currentEffectiveDate.kind !== "success") return currentEffectiveDate;

  const effectiveInstant = parseLocalDate(currentEffectiveDate.localDate);
  if (effectiveInstant === undefined) {
    return { kind: "validation-error", code: "INVALID_SCHEDULE_DATE" };
  }
  const latestDueMonth =
    asOfDate.getTime() + DAY_IN_MILLISECONDS > effectiveInstant.getTime()
      ? asOfMonth
      : shiftMonth(asOfMonth, -1);

  if (compareMonth(first, latestDueMonth) > 0) {
    return { kind: "success", months: [], hasMore: false };
  }

  const completed = new Set(input.completedMonths);
  const due: string[] = [];
  for (
    let month = first;
    compareMonth(month, latestDueMonth) <= 0;
    month = shiftMonth(month, 1)
  ) {
    const value = formatYearMonth(month);
    if (!completed.has(value)) due.push(value);
  }

  return {
    kind: "success",
    months: due.slice(0, input.limit),
    hasMore: due.length > input.limit,
  };
}
