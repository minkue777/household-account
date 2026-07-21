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

function balanceAmount(
  body: string,
  labels: readonly string[],
): number | undefined {
  for (const label of labels) {
    const match = body.match(new RegExp(`${label}\\s*([\\d,]+)원`, "u"));
    if (match !== null) return amountInWon(match[1]);
  }
  return undefined;
}

function paymentWithEmbeddedTime(input: {
  readonly context: ProviderParserContext;
  readonly amount: number;
  readonly merchant: string;
  readonly cardCompany: string;
  readonly localCurrencyType: string;
  readonly dateTime: RegExpMatchArray;
  readonly maskedCardToken?: string;
}): ParsedPaymentGolden | undefined {
  const occurrence = embeddedOccurrence({
    context: input.context,
    month: input.dateTime[1],
    day: input.dateTime[2],
    hour: input.dateTime[3],
    minute: input.dateTime[4],
  });
  if (occurrence.kind === "failure") return undefined;
  return {
    type: "approval",
    amountInWon: input.amount,
    occurredLocalDate: occurrence.occurredLocalDate,
    occurredLocalTime: occurrence.occurredLocalTime,
    merchant: input.merchant,
    cardCompany: input.cardCompany,
    localCurrencyType: input.localCurrencyType,
    ...(input.maskedCardToken === undefined
      ? {}
      : { maskedCardToken: input.maskedCardToken }),
  };
}

function parseGyeonggi(
  context: ProviderParserContext,
): AndroidProviderParseResult {
  const lines = bodyLines(context.body);
  const balance = balanceAmount(context.body, [
    "현재 사용가능 잔액",
    "잔액",
  ]);
  const amountMatch = lines[0]?.match(/^결제\s+([\d,]+)원$/u);
  const dateTime = lines[1]?.match(
    /^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/u,
  );
  const amount = amountMatch === null || amountMatch === undefined
    ? undefined
    : amountInWon(amountMatch[1]);
  const payment =
    amount === undefined || dateTime === null || dateTime === undefined || lines[2] === undefined
      ? undefined
      : paymentWithEmbeddedTime({
          context,
          amount,
          merchant: lines[2],
          cardCompany: "경기지역화폐",
          localCurrencyType: "gyeonggi",
          dateTime,
        });
  if (payment === undefined && balance === undefined) return ignoredParseFailure();
  return {
    kind: "Parsed",
    ...(payment === undefined ? {} : { payment }),
    ...(balance === undefined
      ? {}
      : {
          balance: {
            amountInWon: balance,
            localCurrencyType: "gyeonggi",
          },
        }),
  };
}

function parseDaejeon(
  context: ProviderParserContext,
): AndroidProviderParseResult {
  const lines = bodyLines(context.body);
  const balance = balanceAmount(context.body, ["사용가능금액", "잔액"]);
  const card = lines[0]?.match(/^대전사랑카드\((\d{4})\)$/u);
  const detailedAmount = lines[1]?.match(/^([\d,]+)원\s+결제$/u);
  const detailedDateTime = lines[2]?.match(
    /^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/u,
  );
  let payment: ParsedPaymentGolden | undefined;
  if (
    card !== null &&
    card !== undefined &&
    detailedAmount !== null &&
    detailedAmount !== undefined &&
    detailedDateTime !== null &&
    detailedDateTime !== undefined &&
    lines[3] !== undefined
  ) {
    const amount = amountInWon(detailedAmount[1]);
    if (amount !== undefined) {
      payment = paymentWithEmbeddedTime({
        context,
        amount,
        merchant: lines[3],
        cardCompany: "대전사랑카드",
        maskedCardToken: card[1],
        localCurrencyType: "daejeon",
        dateTime: detailedDateTime,
      });
    }
  } else {
    const fallback = lines[0]?.match(/^(.+?)\s+([\d,]+)원\s+사용$/u);
    const amount = fallback === null || fallback === undefined
      ? undefined
      : amountInWon(fallback[2]);
    const received = receivedLocalTime(context);
    if (fallback !== null && fallback !== undefined && amount !== undefined && received !== undefined) {
      payment = {
        type: "approval",
        amountInWon: amount,
        occurredLocalDate: received.localDate,
        occurredLocalTime: received.localTime,
        merchant: fallback[1].trim(),
        cardCompany: "대전사랑카드",
        localCurrencyType: "daejeon",
        timeSource: received.timeSource,
      };
    }
  }
  if (payment === undefined && balance === undefined) return ignoredParseFailure();
  return {
    kind: "Parsed",
    ...(payment === undefined ? {} : { payment }),
    ...(balance === undefined
      ? {}
      : {
          balance: {
            amountInWon: balance,
            localCurrencyType: "daejeon",
          },
        }),
  };
}

function parseSejong(
  context: ProviderParserContext,
): AndroidProviderParseResult {
  const lines = bodyLines(context.body);
  const balance = balanceAmount(context.body, ["보유 잔액"]);
  const amountMatch = lines[0]?.match(/^결제완료\s+([\d,]+)원$/u);
  const dateTime = lines[1]?.match(
    /^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/u,
  );
  const amount = amountMatch === null || amountMatch === undefined
    ? undefined
    : amountInWon(amountMatch[1]);
  const payment =
    amount === undefined || dateTime === null || dateTime === undefined || lines[2] === undefined
      ? undefined
      : paymentWithEmbeddedTime({
          context,
          amount,
          merchant: lines[2],
          cardCompany: "세종",
          localCurrencyType: "sejong",
          dateTime,
        });
  if (payment === undefined && balance === undefined) return ignoredParseFailure();
  return {
    kind: "Parsed",
    ...(payment === undefined ? {} : { payment }),
    ...(balance === undefined
      ? {}
      : {
          balance: {
            amountInWon: balance,
            localCurrencyType: "sejong",
          },
        }),
  };
}

export const gyeonggiLocalCurrencyProviderParser: ProviderParserDefinition = {
  parserId: "gyeonggi-local-currency-parser",
  supportedPackages: ["gov.gyeonggi.ggcard"],
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
