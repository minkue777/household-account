export interface MonthlySplitInput {
  amountInWon: number;
  startDate: string;
  months: number;
}

export interface MonthlyInstallment {
  sequence: number;
  total: number;
  amountInWon: number;
  accountingDate: string;
}

export type MonthlySplitResult =
  | {
      kind: "success";
      installments: readonly MonthlyInstallment[];
    }
  | {
      kind: "validationError";
      code:
        | "AMOUNT_NOT_POSITIVE_INTEGER"
        | "MONTHS_BELOW_TWO"
        | "INVALID_ACCOUNTING_DATE";
    };

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

function parseLocalDate(value: string): LocalDateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (
    year < 1 ||
    year > 9_999 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month)
  ) {
    return null;
  }

  return { year, month, day };
}

function formatLocalDate({ year, month, day }: LocalDateParts): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function accountingDateAtOffset(
  startDate: LocalDateParts,
  monthOffset: number,
): string | null {
  const absoluteMonth = startDate.year * 12 + (startDate.month - 1) + monthOffset;
  const year = Math.floor(absoluteMonth / 12);
  const month = (absoluteMonth % 12) + 1;

  if (year < 1 || year > 9_999) return null;

  return formatLocalDate({
    year,
    month,
    day: Math.min(startDate.day, daysInMonth(year, month)),
  });
}

export function applyMonthlySplitPolicy(
  input: MonthlySplitInput,
): MonthlySplitResult {
  if (!Number.isSafeInteger(input.amountInWon) || input.amountInWon <= 0) {
    return {
      kind: "validationError",
      code: "AMOUNT_NOT_POSITIVE_INTEGER",
    };
  }

  if (!Number.isSafeInteger(input.months) || input.months < 2) {
    return { kind: "validationError", code: "MONTHS_BELOW_TWO" };
  }

  const startDate = parseLocalDate(input.startDate);
  if (!startDate) {
    return { kind: "validationError", code: "INVALID_ACCOUNTING_DATE" };
  }

  const amountInWon = Math.floor(input.amountInWon / input.months);
  if (amountInWon <= 0) {
    return {
      kind: "validationError",
      code: "AMOUNT_NOT_POSITIVE_INTEGER",
    };
  }

  const installments: MonthlyInstallment[] = [];
  for (let monthOffset = 0; monthOffset < input.months; monthOffset += 1) {
    const accountingDate = accountingDateAtOffset(startDate, monthOffset);
    if (!accountingDate) {
      return { kind: "validationError", code: "INVALID_ACCOUNTING_DATE" };
    }

    installments.push({
      sequence: monthOffset + 1,
      total: input.months,
      amountInWon,
      accountingDate,
    });
  }

  return { kind: "success", installments };
}
