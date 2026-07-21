export interface PaymentOccurrenceYearCandidate {
  month: number;
  day: number;
  hour: number;
  minute: number;
  receivedAt: string;
}

export type PaymentOccurrenceYearPolicyResult =
  | { kind: "success"; occurredLocalDateTime: string }
  | { kind: "parseFailure"; code: "INVALID_DATE" | "INVALID_TIME" };

const SEOUL_OFFSET_HOURS = 9;
const MAXIMUM_DAY_BY_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function seoulYear(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
  }).formatToParts(instant);
  const year = parts.find((part) => part.type === "year")?.value;

  if (year === undefined) {
    throw new Error("Asia/Seoul 연도를 계산할 수 없습니다.");
  }

  return Number(year);
}

function isValidDate(year: number, month: number, day: number): boolean {
  const value = new Date(Date.UTC(year, month - 1, day));
  return (
    value.getUTCFullYear() === year &&
    value.getUTCMonth() === month - 1 &&
    value.getUTCDate() === day
  );
}

function toSeoulInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  return new Date(
    Date.UTC(year, month - 1, day, hour - SEOUL_OFFSET_HOURS, minute),
  );
}

function localDateTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
}

export function applyPaymentOccurrenceYearPolicy(
  candidate: PaymentOccurrenceYearCandidate,
): PaymentOccurrenceYearPolicyResult {
  if (
    !Number.isInteger(candidate.hour) ||
    !Number.isInteger(candidate.minute) ||
    candidate.hour < 0 ||
    candidate.hour > 23 ||
    candidate.minute < 0 ||
    candidate.minute > 59
  ) {
    return { kind: "parseFailure", code: "INVALID_TIME" };
  }

  if (
    !Number.isInteger(candidate.month) ||
    !Number.isInteger(candidate.day) ||
    candidate.month < 1 ||
    candidate.month > 12 ||
    candidate.day < 1 ||
    candidate.day > MAXIMUM_DAY_BY_MONTH[candidate.month - 1]
  ) {
    return { kind: "parseFailure", code: "INVALID_DATE" };
  }

  const receivedAt = new Date(candidate.receivedAt);
  if (Number.isNaN(receivedAt.getTime())) {
    return { kind: "parseFailure", code: "INVALID_DATE" };
  }

  const receivedYear = seoulYear(receivedAt);

  for (let year = receivedYear; year >= receivedYear - 8; year -= 1) {
    if (!isValidDate(year, candidate.month, candidate.day)) continue;

    const occurredAt = toSeoulInstant(
      year,
      candidate.month,
      candidate.day,
      candidate.hour,
      candidate.minute,
    );
    if (occurredAt.getTime() <= receivedAt.getTime()) {
      return {
        kind: "success",
        occurredLocalDateTime: localDateTime(
          year,
          candidate.month,
          candidate.day,
          candidate.hour,
          candidate.minute,
        ),
      };
    }
  }

  return { kind: "parseFailure", code: "INVALID_DATE" };
}
