import type { AndroidProviderParseResult } from "../model/androidProviderParser";
import {
  amountInWon,
  bodyLines,
  embeddedOccurrence,
  flattenedBody,
  ignoredParseFailure,
  paymentAtReceivedTime,
  type ProviderParserContext,
  type ProviderParserDefinition,
} from "./providerParsingSupport";

function parseNaver(context: ProviderParserContext): AndroidProviderParseResult {
  const match = flattenedBody(context.body).match(
    /^(.+?)에서\s+([\d,]+)원을\s+결제했습니다\.?$/u,
  );
  if (match === null) return ignoredParseFailure();
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

function parseToss(context: ProviderParserContext): AndroidProviderParseResult {
  const body = flattenedBody(context.body);
  if (body.includes("가승인")) {
    return { kind: "Ignored", code: "PREAUTHORIZATION" };
  }
  const totalMatch = body.match(/([\d,]+)원\s+결제(?:\s+취소)?/u);
  const dateTime = body.match(
    /(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/u,
  );
  if (totalMatch === null || dateTime === null) return ignoredParseFailure();
  const total = amountInWon(totalMatch[1]);
  if (total === undefined) return ignoredParseFailure("INVALID_AMOUNT");
  const cancellation = body.includes("결제 취소");
  const cashbackMatch = body.match(/캐시백\s+([\d,]+)원/u);
  const cashback = cashbackMatch === null ? 0 : amountInWon(cashbackMatch[1]);
  if (cashback === undefined) return ignoredParseFailure("INVALID_AMOUNT");
  const occurrence = embeddedOccurrence({
    context,
    month: dateTime[1],
    day: dateTime[2],
    hour: dateTime[3],
    minute: dateTime[4],
  });
  if (occurrence.kind === "failure") return ignoredParseFailure(occurrence.code);

  const lines = bodyLines(context.body);
  const dateLineIndex = lines.findIndex((line) =>
    /\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}/u.test(line),
  );
  const merchant = lines[dateLineIndex + 1]?.trim() ?? "";
  if (merchant === "") return { kind: "Rejected", code: "MERCHANT_REQUIRED" };
  return {
    kind: "Parsed",
    payment: {
      type: cancellation ? "cancellation" : "approval",
      amountInWon: cancellation ? total : Math.max(total - cashback, 0),
      occurredLocalDate: occurrence.occurredLocalDate,
      occurredLocalTime: occurrence.occurredLocalTime,
      merchant,
      cardCompany: "토스",
    },
  };
}

function parseKakao(context: ProviderParserContext): AndroidProviderParseResult {
  if (context.title.trim() !== "결제 완료") return ignoredParseFailure();
  const lines = bodyLines(context.body);
  const amountMatch = lines[1]?.match(/^([\d,]+)원$/u);
  if (lines[0] === undefined || amountMatch === null || amountMatch === undefined) {
    return ignoredParseFailure();
  }
  const amount = amountInWon(amountMatch[1]);
  if (amount === undefined) return ignoredParseFailure("INVALID_AMOUNT");
  return paymentAtReceivedTime({
    context,
    payment: {
      type: "approval",
      amountInWon: amount,
      merchant: lines[0],
      cardCompany: "카카오페이",
    },
  });
}

function parseOnnuri(context: ProviderParserContext): AndroidProviderParseResult {
  const match = flattenedBody(context.body).match(
    /^(.+?)에서\s+([\d,]+)원\s+결제$/u,
  );
  if (match === null) return ignoredParseFailure();
  const amount = amountInWon(match[2]);
  if (amount === undefined) return ignoredParseFailure("INVALID_AMOUNT");
  return paymentAtReceivedTime({
    context,
    payment: {
      type: "approval",
      amountInWon: amount,
      merchant: match[1].trim(),
      cardCompany: "디지털온누리",
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
