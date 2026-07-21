import type { ValueValidationResult } from "./moneyInWon";

export type SeoulZoneId = "Asia/Seoul";

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_TIME = /^(\d{2}):(\d{2})$/;
const SEOUL_OFFSET_MILLIS = 9 * 60 * 60 * 1_000;

function validCalendarDate(year: number, month: number, day: number): boolean {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

export function parseLocalDate(
  value: string,
): ValueValidationResult<{ canonical: string }> {
  const match = LOCAL_DATE.exec(value);
  if (match === null) {
    return { kind: "validation-error", code: "LOCAL_DATE_FORMAT_INVALID" };
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return validCalendarDate(year, month, day)
    ? { kind: "success", value: { canonical: value } }
    : { kind: "validation-error", code: "LOCAL_DATE_INVALID" };
}

export function parseLocalTime(
  value: string,
): ValueValidationResult<{ canonical: string }> {
  const match = LOCAL_TIME.exec(value);
  if (match === null) {
    return { kind: "validation-error", code: "LOCAL_TIME_FORMAT_INVALID" };
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59
    ? { kind: "success", value: { canonical: value } }
    : { kind: "validation-error", code: "LOCAL_TIME_INVALID" };
}

export function resolveSeoulMonthBoundary(input: {
  readonly instant: string;
  readonly zoneId: SeoulZoneId;
}): { localDate: string; yearMonth: string } {
  const instant = new Date(input.instant);
  if (Number.isNaN(instant.getTime())) throw new Error("유효한 UTC Instant가 필요합니다.");
  const seoul = new Date(instant.getTime() + SEOUL_OFFSET_MILLIS);
  const localDate = seoul.toISOString().slice(0, 10);
  return { localDate, yearMonth: localDate.slice(0, 7) };
}

export function toStoredUtcInstant(input: {
  readonly localDate: string;
  readonly localTime: string;
  readonly zoneId: SeoulZoneId;
}): ValueValidationResult<{ utcInstant: string }> {
  const date = parseLocalDate(input.localDate);
  if (date.kind === "validation-error") return date;
  const time = parseLocalTime(input.localTime);
  if (time.kind === "validation-error") return time;

  const [year, month, day] = input.localDate.split("-").map(Number);
  const [hour, minute] = input.localTime.split(":").map(Number);
  const utcMillis =
    Date.UTC(year!, month! - 1, day!, hour!, minute!) - SEOUL_OFFSET_MILLIS;
  return {
    kind: "success",
    value: { utcInstant: new Date(utcMillis).toISOString() },
  };
}
