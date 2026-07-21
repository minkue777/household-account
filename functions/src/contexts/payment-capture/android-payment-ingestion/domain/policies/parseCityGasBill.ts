import type {
  CityGasNotificationInput,
  CityGasParseResult,
} from "../model/cityGasBill";
import { parseLocalDate } from "../value-objects/localDate";

const CITY_GAS_BILL_PATTERN =
  /도시가스(?:\s*요금)?\s*청구(?:\s*안내|서)/;
const BILLING_TITLE_PATTERN =
  /\[?(\d{4})년\s*(\d{1,2})월\s*도시가스\s*요금(?:\s*청구서)?\]?/;
const TOTAL_AMOUNT_PATTERNS = [
  /납부하실\s*총\s*금액은\s*([\d,]+)\s*원/,
  /총\s*액\s*([\d,]+)\s*원/,
] as const;
const DUE_DATE_PATTERNS = [
  /납부마감일은?\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/,
  /납부마감일은?\s*(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/,
] as const;

function normalizeInline(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function padTwoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

function localDateValue(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${padTwoDigits(month)}-${padTwoDigits(day)}`;
}

function observedDateAtSeoul(value: string): string {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new Error("observedAtSeoul은 유효한 시각이어야 합니다.");
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  const date = `${part("year")}-${part("month")}-${part("day")}`;

  if (parseLocalDate(date) === undefined) {
    throw new Error("observedAtSeoul에서 서울 수신일을 결정할 수 없습니다.");
  }
  return date;
}

function parseBillingMonth(title: string | undefined): string | undefined {
  if (title === undefined) return undefined;

  const match = BILLING_TITLE_PATTERN.exec(normalizeInline(title));
  if (match === null) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isSafeInteger(year) || year < 1 || month < 1 || month > 12) {
    return undefined;
  }
  return `${String(year).padStart(4, "0")}-${padTwoDigits(month)}`;
}

function parseTotalAmount(value: string): number | undefined {
  for (const pattern of TOTAL_AMOUNT_PATTERNS) {
    const match = pattern.exec(value);
    if (match === null) continue;

    const normalized = match[1].replace(/,/g, "");
    if (!/^\d+$/.test(normalized)) return undefined;
    const amount = Number(normalized);
    return Number.isSafeInteger(amount) && amount >= 0 && amount <= 2_147_483_647
      ? amount
      : undefined;
  }
  return undefined;
}

function parseDueDate(value: string): string | undefined {
  for (const pattern of DUE_DATE_PATTERNS) {
    const match = pattern.exec(value);
    if (match === null) continue;

    const date = localDateValue(
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
    );
    return parseLocalDate(date)?.value;
  }
  return undefined;
}

export function parseCityGasBill(
  input: CityGasNotificationInput,
): CityGasParseResult {
  const normalizedNotification = normalizeInline(
    `${input.title ?? ""}\n${input.body}`,
  );
  if (!CITY_GAS_BILL_PATTERN.test(normalizedNotification)) {
    return { kind: "Ignored", code: "NOT_CITY_GAS_BILL" };
  }

  const amountInWon = parseTotalAmount(normalizedNotification);
  if (amountInWon === undefined) {
    return { kind: "Ignored", code: "TOTAL_AMOUNT_MISSING" };
  }

  const observedDate = observedDateAtSeoul(input.observedAtSeoul);
  const billingMonth = parseBillingMonth(normalizedNotification);
  const dueDate = parseDueDate(normalizedNotification);

  return {
    kind: "Parsed",
    amountInWon,
    transactionType: "fixed",
    categoryKind: "bill",
    billingMonth: billingMonth ?? observedDate.slice(0, 7),
    memoPolicy: billingMonth === undefined ? "Empty" : "BillingTitle",
    accountingDate: dueDate ?? observedDate,
    accountingDateSource:
      dueDate === undefined ? "ObservedDateFallback" : "DueDate",
  };
}
