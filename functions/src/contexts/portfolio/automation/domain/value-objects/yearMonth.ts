export interface YearMonth {
  readonly year: number;
  readonly month: number;
  readonly value: string;
}

const YEAR_MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function parseYearMonth(value: string): YearMonth | undefined {
  const match = YEAR_MONTH_PATTERN.exec(value);
  if (!match) {
    return undefined;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 1) {
    return undefined;
  }

  return { year, month, value };
}

export function daysInMonth(yearMonth: YearMonth): number {
  switch (yearMonth.month) {
    case 2:
      return isLeapYear(yearMonth.year) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    default:
      return 31;
  }
}

export function nextYearMonth(yearMonth: YearMonth): string {
  if (yearMonth.month === 12) {
    return `${String(yearMonth.year + 1).padStart(4, "0")}-01`;
  }

  return `${String(yearMonth.year).padStart(4, "0")}-${String(yearMonth.month + 1).padStart(2, "0")}`;
}

function isLeapYear(year: number): boolean {
  return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
}
