import type {
  ParseShortcutCardMessageInput,
  ShortcutCardMessageParseResult,
} from "../model/shortcutCardMessage";

interface OccurrenceYearInput {
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly receivedAt: string;
  readonly zoneId: "Asia/Seoul";
}

type OccurrenceYearResult =
  | { readonly kind: "success"; readonly occurredLocalDateTime: string }
  | {
      readonly kind: "parseFailure";
      readonly code: "INVALID_DATE" | "INVALID_TIME";
    };

export type ShortcutOccurrenceYearResolver = (
  input: OccurrenceYearInput,
) => OccurrenceYearResult;

const SUPPORTED_COMPANIES = new Map<string, string>([
  ["삼성", "삼성"],
  ["신한", "신한"],
  ["국민", "국민"],
  ["현대", "현대"],
  ["롯데", "롯데"],
  ["하나", "하나"],
  ["우리", "우리"],
  ["BC", "비씨"],
  ["NH", "농협"],
]);

const NH_CARD_SMS_HEADER_PATTERN =
  /^NH(?:농협)?카드([0-9＊*xX-]*)승인(?:\s|$)/u;
const NH_CARD_HOLDER_PATTERN = /^[가-힣]{0,4}[＊*][가-힣]{0,4}$/u;
const NH_SUMMARY_PATTERN = /^(?:총누적|누적|총\s*사용|잔액)/u;
const OCCURRENCE_WITH_OPTIONAL_MERCHANT_PATTERN =
  /^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})(?:\s+(.+))?$/u;
const LOTTE_MERCHANT_FIRST_CARD_PATTERN =
  /롯데(?:카드)?\s*\(?([0-9＊*xX]{4})\)?/u;
const LOTTE_MERCHANT_FIRST_AMOUNT_PATTERN = /^([^\s]+원)\s+승인$/u;
const LOTTE_MERCHANT_FIRST_DATE_PATTERN =
  /^(?:일시불|(?:(?:\d+개월\s*)?할부))\s*,?\s*(\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2})$/u;
const KB_CHECK_CARD_HEADER_PATTERN =
  /^KB국민(?:카드)?(?:신용|체크)\s*\(?([0-9＊*xX]{4})\)?$/u;

function normalizedMaskedToken(value: string): string | undefined {
  const normalized = value
    .replace(/[＊*]/gu, "x")
    .replace(/[^0-9x]/giu, "")
    .toLowerCase()
    .slice(-4);
  return normalized === "" ? undefined : normalized;
}

function parseHeader(
  header: string,
):
  | {
      readonly kind: "success";
      readonly companyLabel: string;
      readonly maskedToken?: string;
      readonly layout: "standard" | "nh-card-sms";
    }
  | Extract<ShortcutCardMessageParseResult, { kind: "Rejected" }> {
  const nhCardSms = header.match(NH_CARD_SMS_HEADER_PATTERN);
  if (nhCardSms !== null) {
    const maskedToken = normalizedMaskedToken(nhCardSms[1]);
    return {
      kind: "success",
      companyLabel: "농협",
      layout: "nh-card-sms",
      ...(maskedToken === undefined ? {} : { maskedToken }),
    };
  }

  const supported = header.match(
    /^(삼성|신한|국민|현대|롯데|하나|우리|BC|NH)([0-9＊*xX-]*)승인(?:\s|$)/u,
  );
  if (supported !== null) {
    const companyLabel = SUPPORTED_COMPANIES.get(supported[1]);
    if (companyLabel === undefined) {
      return { kind: "Rejected", code: "UNSUPPORTED_CARD_COMPANY" };
    }
    const maskedToken = normalizedMaskedToken(supported[2]);
    return {
      kind: "success",
      companyLabel,
      layout: "standard",
      ...(maskedToken === undefined ? {} : { maskedToken }),
    };
  }

  const approvalIndex = header.indexOf("승인");
  if (approvalIndex < 0) {
    return { kind: "Rejected", code: "UNSUPPORTED_MESSAGE" };
  }
  const prefix = header.slice(0, approvalIndex);
  const companyCandidate = prefix
    .replace(/[0-9＊*xX-]/gu, "")
    .trim();
  return companyCandidate === ""
    ? { kind: "Rejected", code: "CARD_COMPANY_REQUIRED" }
    : { kind: "Rejected", code: "UNSUPPORTED_CARD_COMPANY" };
}

function parseAmount(
  amountLine: string,
):
  | { readonly kind: "success"; readonly amountInWon: number }
  | Extract<ShortcutCardMessageParseResult, { kind: "Rejected" }> {
  const match = amountLine.match(
    /^([^\s]+)원(?:\s+(?:일시불|체크|(?:\d+개월\s*)?할부))?$/u,
  );
  if (match === null) {
    return { kind: "Rejected", code: "UNSUPPORTED_MESSAGE" };
  }
  const normalized = match[1].replace(/,/gu, "");
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) {
    return { kind: "Rejected", code: "AMOUNT_NOT_FINITE" };
  }
  if (!/^-?\d+$/u.test(normalized)) {
    return { kind: "Rejected", code: "UNSUPPORTED_MESSAGE" };
  }
  if (amount <= 0) {
    return { kind: "Rejected", code: "AMOUNT_NOT_POSITIVE" };
  }
  if (!Number.isSafeInteger(amount)) {
    return { kind: "Rejected", code: "AMOUNT_OUT_OF_RANGE" };
  }
  return { kind: "success", amountInWon: amount };
}

interface ShortcutPaymentFields {
  readonly amountInWon: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly merchant: string;
}

type ShortcutPaymentFieldsResult =
  | { readonly kind: "success"; readonly fields: ShortcutPaymentFields }
  | Extract<ShortcutCardMessageParseResult, { kind: "Rejected" }>;

function parsedPaymentFields(input: {
  readonly amountLine: string | undefined;
  readonly occurrenceLine: string | undefined;
  readonly separateMerchantLine?: string;
}): ShortcutPaymentFieldsResult {
  if (input.amountLine === undefined || input.occurrenceLine === undefined) {
    return { kind: "Rejected", code: "UNSUPPORTED_MESSAGE" };
  }

  const amount = parseAmount(input.amountLine);
  if (amount.kind === "Rejected") return amount;

  const occurrence = input.occurrenceLine.match(
    OCCURRENCE_WITH_OPTIONAL_MERCHANT_PATTERN,
  );
  if (occurrence === null) {
    return { kind: "Rejected", code: "UNSUPPORTED_MESSAGE" };
  }

  const inlineMerchant = occurrence[5]?.trim() ?? "";
  const separateMerchant = input.separateMerchantLine?.trim() ?? "";
  const merchant = inlineMerchant === "" ? separateMerchant : inlineMerchant;
  if (
    merchant === "" ||
    (inlineMerchant === "" && NH_SUMMARY_PATTERN.test(merchant))
  ) {
    return { kind: "Rejected", code: "UNSUPPORTED_MESSAGE" };
  }

  return {
    kind: "success",
    fields: {
      amountInWon: amount.amountInWon,
      month: Number(occurrence[1]),
      day: Number(occurrence[2]),
      hour: Number(occurrence[3]),
      minute: Number(occurrence[4]),
      merchant,
    },
  };
}

function parseStandardPaymentFields(
  lines: readonly string[],
): ShortcutPaymentFieldsResult {
  return parsedPaymentFields({
    amountLine: lines[1],
    occurrenceLine: lines[2],
  });
}

function parseNhCardSmsPaymentFields(
  lines: readonly string[],
): ShortcutPaymentFieldsResult {
  const hasSeparateCardHolder =
    lines[1] !== undefined && NH_CARD_HOLDER_PATTERN.test(lines[1]);
  const amountIndex = hasSeparateCardHolder ? 2 : 1;
  const occurrenceIndex = amountIndex + 1;

  return parsedPaymentFields({
    amountLine: lines[amountIndex],
    occurrenceLine: lines[occurrenceIndex],
    separateMerchantLine: lines[occurrenceIndex + 1],
  });
}

interface RecognizedShortcutLayout {
  readonly header: {
    readonly kind: "success";
    readonly companyLabel: string;
    readonly maskedToken?: string;
    readonly layout: "standard";
  };
  readonly paymentFields: ShortcutPaymentFieldsResult;
}

function parseLotteMerchantFirstLayout(
  lines: readonly string[],
): RecognizedShortcutLayout | undefined {
  const card = lines
    .map((line) => LOTTE_MERCHANT_FIRST_CARD_PATTERN.exec(line))
    .find((match) => match !== null);
  const amount = LOTTE_MERCHANT_FIRST_AMOUNT_PATTERN.exec(lines[1] ?? "");
  const date = lines
    .map((line) => LOTTE_MERCHANT_FIRST_DATE_PATTERN.exec(line))
    .find((match) => match !== null);
  if (card === undefined || amount === null || date === undefined) {
    return undefined;
  }
  const maskedToken = normalizedMaskedToken(card[1]);
  return {
    header: {
      kind: "success",
      companyLabel: "롯데",
      layout: "standard",
      ...(maskedToken === undefined ? {} : { maskedToken }),
    },
    paymentFields: parsedPaymentFields({
      amountLine: amount[1],
      occurrenceLine: date[1],
      separateMerchantLine: lines[0],
    }),
  };
}

function parseKbCheckCardLayout(
  lines: readonly string[],
): RecognizedShortcutLayout | undefined {
  const card = KB_CHECK_CARD_HEADER_PATTERN.exec(lines[0] ?? "");
  if (card === null) return undefined;
  const maskedToken = normalizedMaskedToken(card[1]);
  const merchant = lines[4]?.replace(/\s*사용\s*$/u, "").trim();
  return {
    header: {
      kind: "success",
      companyLabel: "국민",
      layout: "standard",
      ...(maskedToken === undefined ? {} : { maskedToken }),
    },
    paymentFields: parsedPaymentFields({
      amountLine: lines[3],
      occurrenceLine: lines[2],
      ...(merchant === undefined ? {} : { separateMerchantLine: merchant }),
    }),
  };
}

function parseRecognizedLayout(
  lines: readonly string[],
): RecognizedShortcutLayout | undefined {
  return (
    parseLotteMerchantFirstLayout(lines) ?? parseKbCheckCardLayout(lines)
  );
}

export function parseShortcutCardMessage(input: {
  readonly command: ParseShortcutCardMessageInput;
  readonly resolveOccurrenceYear: ShortcutOccurrenceYearResolver;
}): ShortcutCardMessageParseResult {
  const normalizedLines = input.command.message
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const lines =
    normalizedLines[0] === "[Web발신]"
      ? normalizedLines.slice(1)
      : normalizedLines;
  if (lines.length < 3) {
    return { kind: "Rejected", code: "UNSUPPORTED_MESSAGE" };
  }

  const recognizedLayout = parseRecognizedLayout(lines);
  const header = recognizedLayout?.header ?? parseHeader(lines[0]);
  if (header.kind === "Rejected") return header;
  const paymentFields = recognizedLayout?.paymentFields ??
    (header.layout === "nh-card-sms"
      ? parseNhCardSmsPaymentFields(lines)
      : parseStandardPaymentFields(lines));
  if (paymentFields.kind === "Rejected") return paymentFields;
  const fields = paymentFields.fields;

  const resolved = input.resolveOccurrenceYear({
    month: fields.month,
    day: fields.day,
    hour: fields.hour,
    minute: fields.minute,
    receivedAt: input.command.receivedAt,
    zoneId: input.command.zoneId,
  });
  if (resolved.kind === "parseFailure") {
    return { kind: "Rejected", code: resolved.code };
  }
  const [occurredLocalDate, occurredLocalTime] =
    resolved.occurredLocalDateTime.split("T");
  return {
    kind: "Parsed",
    amountInWon: fields.amountInWon,
    occurredLocalDate,
    occurredLocalTime,
    merchant: fields.merchant,
    cardEvidence: {
      companyLabel: header.companyLabel,
      ...(header.maskedToken === undefined
        ? {}
        : { maskedToken: header.maskedToken }),
    },
  };
}
