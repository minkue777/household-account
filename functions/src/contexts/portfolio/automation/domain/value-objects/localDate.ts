import { daysInMonth, parseYearMonth, type YearMonth } from "./yearMonth";

export interface LocalDate {
  readonly value: string;
  readonly yearMonth: YearMonth;
}

const LOCAL_DATE_PATTERN = /^(\d{4}-(?:0[1-9]|1[0-2]))-(0[1-9]|[12]\d|3[01])$/;

export function parseLocalDate(value: string): LocalDate | undefined {
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) {
    return undefined;
  }

  const yearMonth = parseYearMonth(match[1]);
  const day = Number(match[2]);
  if (!yearMonth || day > daysInMonth(yearMonth)) {
    return undefined;
  }

  return { value, yearMonth };
}
