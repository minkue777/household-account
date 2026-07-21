import type {
  AndroidProviderParseResult,
  ParsedPaymentGolden,
} from "../model/androidProviderParser";
import {
  amountInWon,
  bodyLines,
  embeddedOccurrence,
  ignoredParseFailure,
  paymentAtReceivedTime,
  receivedLocalTime,
  type ProviderParserContext,
  type ProviderParserDefinition,
} from "./providerParsingSupport";

const KB_CARD_PATTERN = /KB국민카드(\d{4})\s*(승인|취소)/u;
const KB_DETAIL_AMOUNT_PATTERN = /([\d,]+)원\s*(?:일시불|할부)?/u;
const KB_DATE_TIME_PATTERN = /(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/u;
const KB_SUMMARY_PATTERN =
  /([\d,]+)원\s+(\d{2})\/(\d{2})(?:\s+(\d{2}):(\d{2}))?/u;

const NH_KEYWORD_PATTERN = /NH카드/u;
const NH_APPROVAL_PATTERN = /승인(취소)?/u;
const NH_CARD_SECTION_PATTERN = /NH카드\s*([^\n]*?)\s*승인/u;
const NH_CARD_TOKEN_PATTERN = /[0-9xX*＊]{4}/u;
const NH_AMOUNT_PATTERN = /([\d,]+)원/u;
const NH_DATE_TIME_PATTERN = /(\d{1,2})\/(\d{1,2})\s+(\d{2}):(\d{2})/u;

const PAYBOOC_CARD_INFO_PATTERN = /(.+?)\(([0-9*xX]{4})\)\s*$/u;
const PAYBOOC_SEPARATED_EVENT_PATTERN = /([\d,]+)원\s*(사용|취소)/u;
const PAYBOOC_INLINE_APPROVAL_PATTERN =
  /^(.+?)\s*에서\s*([\d,]+)원\s*사용(?:\s|$).*/u;
const PAYBOOC_INLINE_CANCELLATION_PATTERN =
  /^\[매출취소\]\s*(.+?)\s*에서\s*([\d,]+)원(?:\([^)]*\))?.*/u;

const SAMSUNG_CARD_PATTERN = /삼성([0-9*xX]{4})\s*(승인|취소)/u;
const SAMSUNG_AMOUNT_PATTERN = /([\d,]+)원\s*(일시불|할부)?/u;
const SAMSUNG_DATE_MERCHANT_PATTERN =
  /(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})\s+(.+)/u;

const LOTTE_AMOUNT_PATTERN = /([\d,]+)원\s*(승인|취소)/u;
const LOTTE_CARD_TOKEN_PATTERN = /\(([0-9*xX]{4})\)/u;
const LOTTE_INSTALLMENT_DATE_PATTERN =
  /(?:일시불|할부[^,]*)\s*,\s*(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/u;

function parsedPayment(
  payment: ParsedPaymentGolden,
): AndroidProviderParseResult {
  return { kind: "Parsed", payment };
}

function occurrence(input: {
  readonly context: ProviderParserContext;
  readonly month: string;
  readonly day: string;
  readonly hour: string;
  readonly minute: string;
}) {
  return embeddedOccurrence(input);
}

function normalizeKbMerchant(value: string): string | undefined {
  const normalized = value.replace(/\s*(승인|취소)\s*$/u, "").trim();
  if (normalized === "" || normalized.startsWith("누적")) return undefined;
  if (/^[\d,\s/:원]+$/u.test(normalized)) return undefined;
  if (/^(신용|체크)\s+\d{4}.*$/u.test(normalized)) return undefined;
  return normalized;
}

function kbMerchantAfter(
  lines: readonly string[],
  startIndex: number,
): string {
  for (let index = startIndex; index < lines.length; index += 1) {
    const merchant = normalizeKbMerchant(lines[index]);
    if (merchant !== undefined) return merchant;
  }
  return "알수없음";
}

function parseKb(context: ProviderParserContext): AndroidProviderParseResult {
  const card = KB_CARD_PATTERN.exec(context.body);
  if (card === null) return ignoredParseFailure();
  const lines = bodyLines(context.body);

  const dateTime = KB_DATE_TIME_PATTERN.exec(context.body);
  const detailAmount = KB_DETAIL_AMOUNT_PATTERN.exec(context.body);
  if (dateTime !== null && detailAmount !== null) {
    const amount = amountInWon(detailAmount[1]);
    const occurred = occurrence({
      context,
      month: dateTime[1],
      day: dateTime[2],
      hour: dateTime[3],
      minute: dateTime[4],
    });
    if (amount === undefined || occurred.kind === "failure") {
      return ignoredParseFailure(
        occurred.kind === "failure" ? occurred.code : "INVALID_AMOUNT",
      );
    }
    const markerIndex = lines.findIndex((line) => line.includes(dateTime[0]));
    return parsedPayment({
      type: card[2] === "취소" ? "cancellation" : "approval",
      amountInWon: amount,
      occurredLocalDate: occurred.occurredLocalDate,
      occurredLocalTime: occurred.occurredLocalTime,
      merchant: markerIndex < 0 ? "알수없음" : kbMerchantAfter(lines, markerIndex + 1),
      cardCompany: "국민",
      maskedCardToken: card[1],
    });
  }

  const summaryIndex = lines.findIndex((line) => KB_SUMMARY_PATTERN.test(line));
  if (summaryIndex < 0) return ignoredParseFailure();
  const summary = KB_SUMMARY_PATTERN.exec(lines[summaryIndex]);
  if (summary === null) return ignoredParseFailure();
  const amount = amountInWon(summary[1]);
  const received = receivedLocalTime(context);
  if (amount === undefined || received === undefined) {
    return ignoredParseFailure(
      amount === undefined ? "INVALID_AMOUNT" : "INVALID_CLOCK",
    );
  }
  const time = summary[4] === "" || summary[4] === undefined
    ? context.postedAt === undefined || context.postedAt.trim() === ""
      ? "00:00"
      : received.localTime
    : `${summary[4]}:${summary[5]}`;
  const occurred = occurrence({
    context,
    month: summary[2],
    day: summary[3],
    hour: time.slice(0, 2),
    minute: time.slice(3, 5),
  });
  if (occurred.kind === "failure") return ignoredParseFailure(occurred.code);
  return parsedPayment({
    type: card[2] === "취소" ? "cancellation" : "approval",
    amountInWon: amount,
    occurredLocalDate: occurred.occurredLocalDate,
    occurredLocalTime: time,
    merchant: kbMerchantAfter(lines, summaryIndex + 1),
    cardCompany: "국민",
    maskedCardToken: card[1],
    ...(summary[4] === "" || summary[4] === undefined
      ? context.postedAt === undefined || context.postedAt.trim() === ""
        ? {}
        : { timeSource: "postedAt" as const }
      : {}),
  });
}

function nhAmount(lines: readonly string[]): number | undefined {
  for (const line of lines) {
    if (
      line.startsWith("잔액") ||
      line.startsWith("총누적") ||
      line.startsWith("총 사용")
    ) {
      continue;
    }
    const match = NH_AMOUNT_PATTERN.exec(line);
    if (match !== null) return amountInWon(match[1]);
  }
  return undefined;
}

function nhCardToken(body: string): string | undefined {
  const section = NH_CARD_SECTION_PATTERN.exec(body)?.[1] ?? "";
  if (section.trim() === "") return undefined;
  const token = NH_CARD_TOKEN_PATTERN.exec(section.replace(/\s+/gu, ""))?.[0];
  return token?.replace(/＊/gu, "*").replace(/X/gu, "x");
}

function nhMerchant(lines: readonly string[], dateValue: string): string {
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index].includes(dateValue)) continue;
    const candidate = lines[index + 1];
    if (
      !candidate.startsWith("잔액") &&
      !candidate.startsWith("총누적") &&
      !candidate.startsWith("총 사용") &&
      !NH_AMOUNT_PATTERN.test(candidate)
    ) {
      return candidate;
    }
  }
  return "알수없음";
}

function parseNh(context: ProviderParserContext): AndroidProviderParseResult {
  if (
    !NH_KEYWORD_PATTERN.test(context.body) ||
    !NH_APPROVAL_PATTERN.test(context.body)
  ) {
    return ignoredParseFailure();
  }
  const lines = bodyLines(context.body);
  const amount = nhAmount(lines);
  const dateTime = NH_DATE_TIME_PATTERN.exec(context.body);
  if (amount === undefined || dateTime === null) return ignoredParseFailure();
  const occurred = occurrence({
    context,
    month: dateTime[1],
    day: dateTime[2],
    hour: dateTime[3],
    minute: dateTime[4],
  });
  if (occurred.kind === "failure") return ignoredParseFailure(occurred.code);
  const token = nhCardToken(context.body);
  return parsedPayment({
    type: context.body.includes("승인취소") ? "cancellation" : "approval",
    amountInWon: amount,
    occurredLocalDate: occurred.occurredLocalDate,
    occurredLocalTime: occurred.occurredLocalTime,
    merchant: nhMerchant(lines, `${dateTime[1]}/${dateTime[2]}`),
    cardCompany: "농협",
    ...(token === undefined ? {} : { maskedCardToken: token }),
  });
}

interface PayboocCardInfo {
  readonly label: string;
  readonly token: string;
}

interface PayboocPaymentEvent {
  readonly type: "approval" | "cancellation";
  readonly amount: number;
  readonly merchant: string;
}

function normalizePayboocCardLabel(value: string): string {
  const candidate = value
    .replace(/\([^)]*\)/gu, " ")
    .trim()
    .split(/\s+/u)
    .at(-1)
    ?.trim() ?? "";
  if (candidate.includes("농협")) return "농협";
  if (candidate.includes("비씨") || /BC/iu.test(candidate)) return "비씨";
  if (candidate.includes("국민")) return "국민";
  if (candidate.includes("우리")) return "우리";
  if (candidate.includes("하나")) return "하나";
  if (candidate.includes("신한")) return "신한";
  if (candidate.includes("삼성")) return "삼성";
  if (candidate.includes("현대")) return "현대";
  if (candidate.includes("롯데")) return "롯데";
  return candidate === "" ? "비씨" : candidate;
}

function payboocCardInfo(lines: readonly string[]): PayboocCardInfo | undefined {
  for (const line of lines) {
    const match = PAYBOOC_CARD_INFO_PATTERN.exec(line);
    if (match === null) continue;
    return { label: normalizePayboocCardLabel(match[1]), token: match[2] };
  }
  return undefined;
}

function payboocEvent(
  lines: readonly string[],
): PayboocPaymentEvent | undefined {
  for (const line of lines) {
    const match = PAYBOOC_INLINE_CANCELLATION_PATTERN.exec(line);
    if (match === null) continue;
    const amount = amountInWon(match[2]);
    const merchant = match[1].trim();
    if (amount === undefined || amount <= 0 || merchant === "") return undefined;
    return { type: "cancellation", amount, merchant };
  }
  for (const line of lines) {
    const match = PAYBOOC_INLINE_APPROVAL_PATTERN.exec(line);
    if (match === null) continue;
    const amount = amountInWon(match[2]);
    const merchant = match[1].trim();
    if (amount === undefined || amount <= 0 || merchant === "") return undefined;
    return { type: "approval", amount, merchant };
  }
  const amountLine = lines.find((line) =>
    PAYBOOC_SEPARATED_EVENT_PATTERN.test(line),
  );
  const amountMatch = amountLine === undefined
    ? null
    : PAYBOOC_SEPARATED_EVENT_PATTERN.exec(amountLine);
  const merchantLine = lines.find(
    (line) =>
      line.endsWith("에서") &&
      !PAYBOOC_CARD_INFO_PATTERN.test(line) &&
      !PAYBOOC_SEPARATED_EVENT_PATTERN.test(line) &&
      !line.includes("누적금액"),
  );
  if (amountMatch === null || merchantLine === undefined) return undefined;
  const amount = amountInWon(amountMatch[1]);
  const merchant = merchantLine.slice(0, -"에서".length).trim();
  if (amount === undefined || amount <= 0 || merchant === "") return undefined;
  return {
    type: amountMatch[2] === "취소" ? "cancellation" : "approval",
    amount,
    merchant,
  };
}

function parsePaybooc(
  context: ProviderParserContext,
): AndroidProviderParseResult {
  const lines = bodyLines(context.body);
  const card = payboocCardInfo(lines);
  const event = payboocEvent(lines);
  if (card === undefined || event === undefined) return ignoredParseFailure();
  return paymentAtReceivedTime({
    context,
    payment: {
      type: event.type,
      amountInWon: event.amount,
      merchant: event.merchant,
      cardCompany: card.label,
      maskedCardToken: card.token,
    },
  });
}

function parseSamsung(
  context: ProviderParserContext,
): AndroidProviderParseResult {
  const card = SAMSUNG_CARD_PATTERN.exec(context.body);
  const amountMatch = SAMSUNG_AMOUNT_PATTERN.exec(context.body);
  const dateMerchant = SAMSUNG_DATE_MERCHANT_PATTERN.exec(context.body);
  if (card === null || amountMatch === null || dateMerchant === null) {
    return ignoredParseFailure();
  }
  const amount = amountInWon(amountMatch[1]);
  const occurred = occurrence({
    context,
    month: dateMerchant[1],
    day: dateMerchant[2],
    hour: dateMerchant[3],
    minute: dateMerchant[4],
  });
  if (amount === undefined || occurred.kind === "failure") {
    return ignoredParseFailure(
      occurred.kind === "failure" ? occurred.code : "INVALID_AMOUNT",
    );
  }
  return parsedPayment({
    type: card[2] === "취소" ? "cancellation" : "approval",
    amountInWon: amount,
    occurredLocalDate: occurred.occurredLocalDate,
    occurredLocalTime: occurred.occurredLocalTime,
    merchant: dateMerchant[5].trim(),
    cardCompany: "삼성",
    maskedCardToken: card[1],
  });
}

function normalizeLotteMerchant(value: string): string | undefined {
  if (value === "" || value === "카드이용" || value === "롯데카드") {
    return undefined;
  }
  if (/^\d+일\s*전$/u.test(value)) return undefined;
  if (LOTTE_AMOUNT_PATTERN.test(value)) return undefined;
  if (LOTTE_CARD_TOKEN_PATTERN.test(value)) return undefined;
  if (LOTTE_INSTALLMENT_DATE_PATTERN.test(value)) return undefined;
  return value;
}

function parseLotte(context: ProviderParserContext): AndroidProviderParseResult {
  const lines = bodyLines(context.body);
  const amountIndex = lines.findIndex((line) => LOTTE_AMOUNT_PATTERN.test(line));
  const cardIndex = lines.findIndex((line) => LOTTE_CARD_TOKEN_PATTERN.test(line));
  const dateIndex = lines.findIndex((line) =>
    LOTTE_INSTALLMENT_DATE_PATTERN.test(line),
  );
  if (amountIndex < 0 || cardIndex < 0 || dateIndex < 0) {
    return ignoredParseFailure();
  }
  const amountMatch = LOTTE_AMOUNT_PATTERN.exec(lines[amountIndex]);
  const card = LOTTE_CARD_TOKEN_PATTERN.exec(lines[cardIndex]);
  const dateTime = LOTTE_INSTALLMENT_DATE_PATTERN.exec(lines[dateIndex]);
  if (amountMatch === null || card === null || dateTime === null) {
    return ignoredParseFailure();
  }
  const amount = amountInWon(amountMatch[1]);
  const occurred = occurrence({
    context,
    month: dateTime[1],
    day: dateTime[2],
    hour: dateTime[3],
    minute: dateTime[4],
  });
  if (amount === undefined || occurred.kind === "failure") {
    return ignoredParseFailure(
      occurred.kind === "failure" ? occurred.code : "INVALID_AMOUNT",
    );
  }
  let merchant = "알수없음";
  for (let index = amountIndex - 1; index >= 0; index -= 1) {
    const candidate = normalizeLotteMerchant(lines[index]);
    if (candidate !== undefined) {
      merchant = candidate;
      break;
    }
  }
  return parsedPayment({
    type: amountMatch[2] === "취소" ? "cancellation" : "approval",
    amountInWon: amount,
    occurredLocalDate: occurred.occurredLocalDate,
    occurredLocalTime: occurred.occurredLocalTime,
    merchant,
    cardCompany: "롯데",
    maskedCardToken: card[1],
  });
}

export const kbCardProviderParser: ProviderParserDefinition = {
  parserId: "kb-card-parser",
  supportedPackages: ["com.kbcard.cxh.appcard", "com.kbcard.kbkookmincard"],
  parse: parseKb,
};

export const nhPayProviderParser: ProviderParserDefinition = {
  parserId: "nh-pay-parser",
  supportedPackages: ["nh.smart.nhallonepay"],
  parse: parseNh,
};

export const payboocProviderParser: ProviderParserDefinition = {
  parserId: "paybooc-isp-parser",
  supportedPackages: ["kvp.jjy.MispAndroid320"],
  parse: parsePaybooc,
};

export const samsungCardProviderParser: ProviderParserDefinition = {
  parserId: "samsung-card-parser",
  supportedPackages: ["com.samsung.android.spay", "kr.co.samsungcard.mpocket"],
  parse: parseSamsung,
};

export const lotteCardProviderParser: ProviderParserDefinition = {
  parserId: "lotte-card-parser",
  supportedPackages: ["com.lcacApp"],
  parse: parseLotte,
};
