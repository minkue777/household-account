import type { AndroidProviderParseResult } from "../model/androidProviderParser";
import {
  amountInWon,
  bodyLines,
  ignoredParseFailure,
  paymentAtReceivedTime,
  type ProviderParserContext,
  type ProviderParserDefinition,
} from "./providerParsingSupport";

const NAVER_PAYMENT_PATTERN =
  /(.+?)에서\s*([\d,]+)원을?\s*결제(?:했습니다|했어요|됐어요)/u;
const NAVER_TITLE_PATTERN = /^네이버페이\s*/u;

const TOSS_AMOUNT_EVENT_PATTERN = /([\d,]+)원\s*(결제(?:\s*취소)?)/u;
const TOSS_MERCHANT_PATTERN =
  /(?:토스뱅크\s*체크카드|페이스페이\s*\(토스뱅크\))\s*\|\s*(.+)/u;
const TOSS_AMOUNT_MERCHANT_PATTERN =
  /[\d,]+원\s*결제(?:\s*취소)?\s*\|\s*(.+)/u;
const TOSS_CASHBACK_PATTERN = /^([\d,]+)원\s*캐시백/mu;

const KAKAO_PAYMENT_TITLE_PATTERN = /결제가\s*완료되었어요/u;
const KAKAO_PAYMENT_BODY_PATTERN =
  /(.+?)에서\s*([\d,]+)원을\s*결제했어요\.?/u;
const KAKAO_APP_PREFIX_PATTERN = /^카카오페이\s*/u;
const KAKAO_TITLE_PREFIX_PATTERN = /^결제가\s*완료되었어요\s*/u;

const ONNURI_PAYMENT_PATTERN =
  /\[디지털온누리상품권\]\s*(?:[^,\n]+님,\s*)?(.+?)에서\s*([\d,]+)원이\s*결제/u;

function parseNaver(context: ProviderParserContext): AndroidProviderParseResult {
  const lines = bodyLines(context.body);
  const hasMarker = lines.some((line) => NAVER_TITLE_PATTERN.test(line)) ||
    context.body.includes("네이버페이");
  if (!hasMarker) return ignoredParseFailure();
  for (const line of lines) {
    const match = NAVER_PAYMENT_PATTERN.exec(
      line.replace(NAVER_TITLE_PATTERN, "").trim(),
    );
    if (match === null) continue;
    const amount = amountInWon(match[2]);
    if (amount === undefined) return ignoredParseFailure("INVALID_AMOUNT");
    return paymentAtReceivedTime({
      context,
      payment: {
        type: "approval",
        amountInWon: amount,
        merchant: match[1].trim(),
        cardCompany: "네이버페이",
      },
    });
  }
  return ignoredParseFailure();
}

function parseToss(context: ProviderParserContext): AndroidProviderParseResult {
  const normalized = bodyLines(context.body).join("\n").trim();
  const amountEvent = TOSS_AMOUNT_EVENT_PATTERN.exec(normalized);
  const merchantMatch = TOSS_MERCHANT_PATTERN.exec(normalized) ??
    TOSS_AMOUNT_MERCHANT_PATTERN.exec(normalized);
  if (amountEvent === null || merchantMatch === null) return ignoredParseFailure();
  const merchant = merchantMatch[1].trim();
  if (merchant.includes("가승인")) {
    return { kind: "Ignored", code: "PREAUTHORIZATION" };
  }
  const grossAmount = amountInWon(amountEvent[1]);
  const cashbackMatch = TOSS_CASHBACK_PATTERN.exec(normalized);
  const cashback = cashbackMatch === null
    ? 0
    : (amountInWon(cashbackMatch[1]) ?? 0);
  if (grossAmount === undefined) {
    return ignoredParseFailure("INVALID_AMOUNT");
  }
  const cancellation = amountEvent[2].includes("취소");
  return paymentAtReceivedTime({
    context,
    payment: {
      type: cancellation ? "cancellation" : "approval",
      amountInWon: cancellation
        ? grossAmount
        : Math.max(grossAmount - cashback, 0),
      merchant,
      cardCompany: "토스",
    },
  });
}

function sanitizeKakaoLine(value: string): string {
  return value
    .replace(KAKAO_APP_PREFIX_PATTERN, "")
    .replace(KAKAO_TITLE_PREFIX_PATTERN, "")
    .trim();
}

function parseKakao(context: ProviderParserContext): AndroidProviderParseResult {
  const lines = bodyLines(context.body);
  const joined = lines.join(" ");
  if (!KAKAO_PAYMENT_TITLE_PATTERN.test(joined)) return ignoredParseFailure();
  const combined = sanitizeKakaoLine(joined);
  const candidates = [...lines.map(sanitizeKakaoLine), combined];
  const payment = candidates
    .map((candidate) => KAKAO_PAYMENT_BODY_PATTERN.exec(candidate))
    .find((match) => match !== null);
  if (payment === undefined || payment === null) return ignoredParseFailure();
  const amount = amountInWon(payment[2]);
  if (amount === undefined) return ignoredParseFailure("INVALID_AMOUNT");
  return paymentAtReceivedTime({
    context,
    payment: {
      type: "approval",
      amountInWon: amount,
      merchant: payment[1].trim(),
      cardCompany: "카카오페이",
    },
  });
}

function parseOnnuri(context: ProviderParserContext): AndroidProviderParseResult {
  const normalized = bodyLines(context.body).join(" ").trim();
  const payment = ONNURI_PAYMENT_PATTERN.exec(normalized);
  if (payment === null) return ignoredParseFailure();
  const amount = amountInWon(payment[2]);
  if (amount === undefined) return ignoredParseFailure("INVALID_AMOUNT");
  return paymentAtReceivedTime({
    context,
    payment: {
      type: "approval",
      amountInWon: amount,
      merchant: payment[1].trim(),
      cardCompany: "온누리상품권",
    },
  });
}

export const naverPayProviderParser: ProviderParserDefinition = {
  parserId: "naver-pay-parser",
  supportedPackages: ["com.naverfin.payapp"],
  parse: parseNaver,
};

export const tossBankProviderParser: ProviderParserDefinition = {
  parserId: "toss-bank-parser",
  supportedPackages: ["viva.republica.toss"],
  parse: parseToss,
};

export const kakaoPayProviderParser: ProviderParserDefinition = {
  parserId: "kakao-pay-parser",
  supportedPackages: ["com.kakaopay.app"],
  parse: parseKakao,
};

export const digitalOnnuriProviderParser: ProviderParserDefinition = {
  parserId: "digital-onnuri-parser",
  supportedPackages: ["com.komsco.kpay"],
  parse: parseOnnuri,
};
