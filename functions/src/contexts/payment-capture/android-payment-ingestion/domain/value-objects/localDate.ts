export interface LocalDate {
  readonly value: string;
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const LOCAL_DATE_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function isLeapYear(year: number): boolean {
  return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function parseLocalDate(value: string): LocalDate | undefined {
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || day > daysInMonth(year, month)) return undefined;

  return { value, year, month, day };
}

export function subtractCalendarDays(date: LocalDate, days: number): string {
  const instant = new Date(Date.UTC(date.year, date.month - 1, date.day));
  instant.setUTCDate(instant.getUTCDate() - days);
  return instant.toISOString().slice(0, 10);
}
