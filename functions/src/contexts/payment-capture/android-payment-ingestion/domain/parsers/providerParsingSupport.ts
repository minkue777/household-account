import type {
  AndroidProviderParseResult,
  ParsedPaymentGolden,
} from "../model/androidProviderParser";

const SEOUL_OFFSET_MILLISECONDS = 9 * 60 * 60 * 1_000;

export interface PaymentOccurrenceYearInput {
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly receivedAt: string;
  readonly zoneId: "Asia/Seoul";
}

export type PaymentOccurrenceYearResult =
  | { readonly kind: "success"; readonly occurredLocalDateTime: string }
  | {
      readonly kind: "parseFailure";
      readonly code: "INVALID_DATE" | "INVALID_TIME";
    };

export type PaymentOccurrenceYearResolver = (
  input: PaymentOccurrenceYearInput,
) => PaymentOccurrenceYearResult;

export interface ProviderParserContext {
  readonly title: string;
  readonly body: string;
  readonly postedAt?: string;
  readonly clockNow: string;
  readonly resolveOccurrenceYear: PaymentOccurrenceYearResolver;
}

export interface ProviderParserDefinition {
  readonly parserId: string;
  readonly supportedPackages: readonly string[];
  parse(context: ProviderParserContext): AndroidProviderParseResult;
}

export interface ReceivedLocalTime {
  readonly receivedAt: string;
  readonly localDate: string;
  readonly localTime: string;
  readonly timeSource: "postedAt" | "clock";
}

function validInstant(value: string | undefined): Date | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? undefined : instant;
}

export function hasValidPostedAt(value: string | undefined): boolean {
  return validInstant(value) !== undefined;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function receivedLocalTime(
  context: Pick<ProviderParserContext, "postedAt" | "clockNow">,
): ReceivedLocalTime | undefined {
  const postedAt = validInstant(context.postedAt);
  const instant = postedAt ?? validInstant(context.clockNow);
  if (instant === undefined) return undefined;

  const seoul = new Date(instant.getTime() + SEOUL_OFFSET_MILLISECONDS);
  return {
    receivedAt: instant.toISOString(),
    localDate: `${seoul.getUTCFullYear()}-${pad(seoul.getUTCMonth() + 1)}-${pad(
      seoul.getUTCDate(),
    )}`,
    localTime: `${pad(seoul.getUTCHours())}:${pad(seoul.getUTCMinutes())}`,
    timeSource: postedAt === undefined ? "clock" : "postedAt",
  };
}

export function bodyLines(body: string): readonly string[] {
  return body
    .split(/\r\n|\n|\r/u)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

export function flattenedBody(body: string): string {
  return bodyLines(body).join(" ");
}

export function amountInWon(value: string): number | undefined {
  const normalized = value.replace(/,/gu, "").trim();
  if (!/^\d+$/u.test(normalized)) return undefined;
  const amount = Number(normalized);
  return Number.isSafeInteger(amount) && amount <= 2_147_483_647
    ? amount
    : undefined;
}

export function embeddedOccurrence(input: {
  readonly context: ProviderParserContext;
  readonly month: string;
  readonly day: string;
  readonly hour: string;
  readonly minute: string;
}):
  | {
      readonly kind: "success";
      readonly occurredLocalDate: string;
      readonly occurredLocalTime: string;
    }
  | { readonly kind: "failure"; readonly code: string } {
  const received = receivedLocalTime(input.context);
  if (received === undefined) return { kind: "failure", code: "INVALID_CLOCK" };

  const result = input.context.resolveOccurrenceYear({
    month: Number(input.month),
    day: Number(input.day),
    hour: Number(input.hour),
    minute: Number(input.minute),
    receivedAt: received.receivedAt,
    zoneId: "Asia/Seoul",
  });
  if (result.kind === "parseFailure") {
    return { kind: "failure", code: result.code };
  }
  const [occurredLocalDate, occurredLocalTime] =
    result.occurredLocalDateTime.split("T");
  return { kind: "success", occurredLocalDate, occurredLocalTime };
}

export function paymentAtReceivedTime(input: {
  readonly context: ProviderParserContext;
  readonly payment: Omit<
    ParsedPaymentGolden,
    "occurredLocalDate" | "occurredLocalTime" | "timeSource"
  >;
}): AndroidProviderParseResult {
  const received = receivedLocalTime(input.context);
  if (received === undefined) return { kind: "Ignored", code: "INVALID_CLOCK" };
  return {
    kind: "Parsed",
    payment: {
      ...input.payment,
      occurredLocalDate: received.localDate,
      occurredLocalTime: received.localTime,
      timeSource: received.timeSource,
    },
  };
}

export function ignoredParseFailure(code = "PARSE_FAILED"): AndroidProviderParseResult {
  return { kind: "Ignored", code };
}
