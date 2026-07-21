import type {
  AndroidProviderParseResult,
  ParsedPaymentGolden,
} from "../model/androidProviderParser";
import {
  amountInWon,
  bodyLines,
  embeddedOccurrence,
  ignoredParseFailure,
  receivedLocalTime,
  type ProviderParserContext,
  type ProviderParserDefinition,
} from "./providerParsingSupport";

const BALANCE_PATTERNS = [
  /잔액\s*([\d,]+)원/u,
  /총\s*보유\s*잔액\s*([\d,]+)원/u,
  /보유\s*잔액\s*[:\s]*([\d,]+)원/u,
] as const;

const PAYMENT_PATTERNS = [
  /결제\s*완료\s*([\d,]+)원/u,
  /결제\s*([\d,]+)원/u,
  /승인\s*([\d,]+)원/u,
  /사용\s*완료?\s*([\d,]+)원/u,
  /([\d,]+)원\s*결제/u,
  /([\d,]+)원\s*승인/u,
] as const;

const GYEONGGI_DATE_TIME_PATTERN =
  /(?:\d{4}\/)?(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/u;

const DAEJEON_DETAILED_PAYMENT_PATTERN =
  /([^\s]+(?:\s*[^\s]+)?)\s+체크카드\((\d{4})\)\s+승인\s+([\d,]+)원(?:\s+캐시백적립\s+[\d,]+원)?\s+(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})\s+(.+?)\s+잔액\s*([\d,]+)원/u;
const DAEJEON_CARD_PATTERN = /체크카드\((\d{4})\)/u;
const DAEJEON_DATE_TIME_PATTERN =
  /(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/u;

const SEJONG_PAYMENT_PATTERN = /결제\s*완료\s*([\d,]+)원/u;
const SEJONG_BALANCE_PATTERN = /여민전\s*총\s*보유\s*잔액\s*([\d,]+)원/u;

function flattened(value: string): string {
  return bodyLines(value).join(" ").replace(/\s+/gu, " ").trim();
}

function localCurrencyLines(value: string): readonly string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function firstAmount(
  value: string,
  patterns: readonly RegExp[],
): number | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (match === null) continue;
    const amount = amountInWon(match[1]);
    if (amount !== undefined) return amount;
  }
  return undefined;
}

function firstPaymentMatch(value: string): RegExpExecArray | undefined {
  for (const pattern of PAYMENT_PATTERNS) {
    const match = pattern.exec(value);
    if (match !== null) return match;
  }
  return undefined;
}

function receivedPaymentTime(
  context: ProviderParserContext,
): Pick<
  ParsedPaymentGolden,
  "occurredLocalDate" | "occurredLocalTime" | "timeSource"
> | undefined {
  const received = receivedLocalTime(context);
  if (received === undefined) return undefined;
  return {
    occurredLocalDate: received.localDate,
    occurredLocalTime: received.localTime,
    timeSource: received.timeSource,
  };
}

function embeddedPaymentTime(
  context: ProviderParserContext,
  month: string,
  day: string,
  hour: string,
  minute: string,
): Pick<ParsedPaymentGolden, "occurredLocalDate" | "occurredLocalTime"> | undefined {
  const occurred = embeddedOccurrence({
    context,
    month,
    day,
    hour,
    minute,
  });
  return occurred.kind === "failure"
    ? undefined
    : {
        occurredLocalDate: occurred.occurredLocalDate,
        occurredLocalTime: occurred.occurredLocalTime,
      };
}

function localPaymentResult(input: {
  readonly payment?: ParsedPaymentGolden;
  readonly balance?: number;
  readonly localCurrencyType: "gyeonggi" | "daejeon" | "sejong";
}): AndroidProviderParseResult {
  if (input.payment === undefined && input.balance === undefined) {
    return ignoredParseFailure();
  }
  return {
    kind: "Parsed",
    ...(input.payment === undefined ? {} : { payment: input.payment }),
    ...(input.balance === undefined
      ? {}
      : {
          balance: {
            amountInWon: input.balance,
            localCurrencyType: input.localCurrencyType,
          },
        }),
  };
}

function isGyeonggiMerchant(value: string): boolean {
  if (value === "") return false;
  if (value.includes("결제") || value.includes("승인") || value.includes("사용")) {
    return false;
  }
  if (value.includes("잔액") || value.includes("인센티브")) return false;
  if (value.includes("지역화폐") || value.includes("착한페이")) return false;
  if (/^[\d,\s:/]+원?$/u.test(value)) return false;
  if (value.startsWith("총") || value.startsWith("누적")) return false;
  return value.length >= 2 && value.length <= 60;
}

function cleanupLocalMerchant(value: string): string {
  return value.replace(/\s+잔액\s*[\d,]+원$/u, "").trim();
}

function gyeonggiMerchant(lines: readonly string[]): string {
  for (let index = 0; index < lines.length - 1; index += 1) {
    const line = lines[index];
    if (!line.includes("결제") && !line.includes("승인") && !line.includes("사용")) {
      continue;
    }
    if (isGyeonggiMerchant(lines[index + 1])) {
      return cleanupLocalMerchant(lines[index + 1]);
    }
  }
  const candidate = lines.find(isGyeonggiMerchant);
  return candidate === undefined ? "알수없음" : cleanupLocalMerchant(candidate);
}

function parseGyeonggi(
  context: ProviderParserContext,
): AndroidProviderParseResult {
  const balance = firstAmount(context.body, BALANCE_PATTERNS);
  const paymentMatch = firstPaymentMatch(context.body);
  let payment: ParsedPaymentGolden | undefined;
  if (paymentMatch !== undefined) {
    const amount = amountInWon(paymentMatch[1]);
    const embedded = GYEONGGI_DATE_TIME_PATTERN.exec(context.body);
    const occurred = embedded === null
      ? receivedPaymentTime(context)
      : embeddedPaymentTime(
          context,
          embedded[1],
          embedded[2],
          embedded[3],
          embedded[4],
        );
    if (amount !== undefined && occurred !== undefined) {
      payment = {
        type: "approval",
        amountInWon: amount,
        ...occurred,
        merchant: gyeonggiMerchant(localCurrencyLines(context.body)),
        cardCompany: "경기지역화폐",
        localCurrencyType: "gyeonggi",
      };
    }
  }
  return localPaymentResult({ payment, balance, localCurrencyType: "gyeonggi" });
}

function isDaejeonMerchant(value: string): boolean {
  if (value === "") return false;
  if (value.includes("승인") || value.includes("결제") || value.includes("사용")) {
    return false;
  }
  if (value.includes("잔액") || value.includes("캐시백적립")) return false;
  if (/^[\d,\s:/]+원?$/u.test(value)) return false;
  if (value.startsWith("총") || value.startsWith("누적")) return false;
  return value.length >= 2 && value.length <= 60;
}

function daejeonMerchant(
  lines: readonly string[],
  body: string,
): string {
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (
      DAEJEON_DATE_TIME_PATTERN.test(lines[index]) &&
      isDaejeonMerchant(lines[index + 1])
    ) {
      return cleanupLocalMerchant(lines[index + 1]);
    }
  }
  for (let index = 0; index < lines.length - 1; index += 1) {
    const line = lines[index];
    if (
      (line.includes("결제") || line.includes("승인") || line.includes("사용")) &&
      isDaejeonMerchant(lines[index + 1])
    ) {
      return cleanupLocalMerchant(lines[index + 1]);
    }
  }
  const detailed = DAEJEON_DETAILED_PAYMENT_PATTERN.exec(flattened(body));
  if (detailed !== null) return cleanupLocalMerchant(detailed[8]);
  const candidate = lines.find(isDaejeonMerchant);
  return candidate === undefined ? "알수없음" : cleanupLocalMerchant(candidate);
}

function parseDaejeon(
  context: ProviderParserContext,
): AndroidProviderParseResult {
  const normalized = flattened(context.body);
  const detailed = DAEJEON_DETAILED_PAYMENT_PATTERN.exec(normalized);
  const commonBalance = firstAmount(context.body, BALANCE_PATTERNS);
  let balance = commonBalance;
  let payment: ParsedPaymentGolden | undefined;

  if (detailed !== null) {
    const amount = amountInWon(detailed[3]);
    const detailedBalance = amountInWon(detailed[9]);
    const occurred = embeddedPaymentTime(
      context,
      detailed[4],
      detailed[5],
      detailed[6],
      detailed[7],
    );
    balance = detailedBalance ?? commonBalance;
    if (amount !== undefined && occurred !== undefined) {
      payment = {
        type: "approval",
        amountInWon: amount,
        ...occurred,
        merchant: detailed[8].trim(),
        cardCompany: "대전사랑카드",
        maskedCardToken: detailed[2],
        localCurrencyType: "daejeon",
      };
    }
  } else {
    const paymentMatch = firstPaymentMatch(context.body);
    const amount = paymentMatch === undefined
      ? undefined
      : amountInWon(paymentMatch[1]);
    if (amount !== undefined) {
      const dateTime = DAEJEON_DATE_TIME_PATTERN.exec(context.body);
      const occurred = dateTime === null
        ? receivedPaymentTime(context)
        : embeddedPaymentTime(
            context,
            dateTime[1],
            dateTime[2],
            dateTime[3],
            dateTime[4],
          );
      if (occurred !== undefined) {
        const token = DAEJEON_CARD_PATTERN.exec(context.body)?.[1];
        payment = {
          type: "approval",
          amountInWon: amount,
          ...occurred,
          merchant: daejeonMerchant(localCurrencyLines(context.body), context.body),
          cardCompany: "대전사랑카드",
          ...(token === undefined ? {} : { maskedCardToken: token }),
          localCurrencyType: "daejeon",
        };
      }
    }
  }
  return localPaymentResult({ payment, balance, localCurrencyType: "daejeon" });
}

function isSejongMerchant(value: string): boolean {
  if (value === "" || value === "세종지역화폐" || value === "여민전") {
    return false;
  }
  if (SEJONG_PAYMENT_PATTERN.test(value) || SEJONG_BALANCE_PATTERN.test(value)) {
    return false;
  }
  return value.length >= 2 && value.length <= 60;
}

function sejongMerchant(lines: readonly string[]): string {
  const paymentIndex = lines.findIndex((line) => SEJONG_PAYMENT_PATTERN.test(line));
  if (paymentIndex >= 0 && isSejongMerchant(lines[paymentIndex + 1] ?? "")) {
    return lines[paymentIndex + 1];
  }
  return lines.find(isSejongMerchant) ?? "알 수 없음";
}

function parseSejong(
  context: ProviderParserContext,
): AndroidProviderParseResult {
  const balance = firstAmount(context.body, [SEJONG_BALANCE_PATTERN]);
  const amountMatch = SEJONG_PAYMENT_PATTERN.exec(context.body);
  let payment: ParsedPaymentGolden | undefined;
  if (amountMatch !== null) {
    const amount = amountInWon(amountMatch[1]);
    const occurred = receivedPaymentTime(context);
    if (amount !== undefined && occurred !== undefined) {
      payment = {
        type: "approval",
        amountInWon: amount,
        ...occurred,
        merchant: sejongMerchant(bodyLines(context.body)),
        cardCompany: "세종지역화폐",
        localCurrencyType: "sejong",
      };
    }
  }
  return localPaymentResult({ payment, balance, localCurrencyType: "sejong" });
}

export const gyeonggiLocalCurrencyProviderParser: ProviderParserDefinition = {
  parserId: "gyeonggi-local-currency-parser",
  supportedPackages: [
    "com.mobiletoong.gpay",
    "com.coocon.chakwallet",
    "gov.gyeonggi.ggcard",
  ],
  parse: parseGyeonggi,
};

export const daejeonLocalCurrencyProviderParser: ProviderParserDefinition = {
  parserId: "daejeon-local-currency-parser",
  supportedPackages: ["kr.co.nmcs.daejeonpay"],
  parse: parseDaejeon,
};

export const sejongLocalCurrencyProviderParser: ProviderParserDefinition = {
  parserId: "sejong-local-currency-parser",
  supportedPackages: ["gov.sejong.yeominpay"],
  parse: parseSejong,
};
