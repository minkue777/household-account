import type {
  AndroidProviderParseResult,
  ParsedPaymentGolden,
} from "../model/androidProviderParser";
import {
  amountInWon,
  embeddedOccurrence,
  flattenedBody,
  hasValidPostedAt,
  ignoredParseFailure,
  receivedLocalTime,
  type ProviderParserContext,
  type ProviderParserDefinition,
} from "./providerParsingSupport";

function parsedPayment(
  payment: ParsedPaymentGolden,
): AndroidProviderParseResult {
  return { kind: "Parsed", payment };
}

function occurrenceFromMatch(
  context: ProviderParserContext,
  match: RegExpMatchArray,
  indexes: { month: number; day: number; hour: number; minute: number },
) {
  return embeddedOccurrence({
    context,
    month: match[indexes.month],
    day: match[indexes.day],
    hour: match[indexes.hour],
    minute: match[indexes.minute],
  });
}

function parseKb(context: ProviderParserContext): AndroidProviderParseResult {
  const body = flattenedBody(context.body);
  const standard = body.match(
    /^(승인취소|승인)\s+([\d,]+)원\s+(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})\s+국민\((\d{4})\)\s+(.+)$/u,
  );
  if (standard !== null) {
    const amount = amountInWon(standard[2]);
    const occurrence = occurrenceFromMatch(context, standard, {
      month: 3,
      day: 4,
      hour: 5,
      minute: 6,
    });
    if (amount === undefined || occurrence.kind === "failure") {
      return ignoredParseFailure(
        occurrence.kind === "failure" ? occurrence.code : "INVALID_AMOUNT",
      );
    }
    return parsedPayment({
      type: standard[1] === "승인취소" ? "cancellation" : "approval",
      amountInWon: amount,
      occurredLocalDate: occurrence.occurredLocalDate,
      occurredLocalTime: occurrence.occurredLocalTime,
      merchant: standard[8].trim(),
      cardCompany: "국민",
      maskedCardToken: standard[7],
    });
  }

  const summary = body.match(
    /^(\d{1,2})\/(\d{1,2})\s+이용금액\s+([\d,]+)원\s+국민\((\d{4})\)\s+(.+)$/u,
  );
  if (summary === null) return ignoredParseFailure();

  const amount = amountInWon(summary[3]);
  const received = receivedLocalTime(context);
  if (amount === undefined || received === undefined) {
    return ignoredParseFailure(amount === undefined ? "INVALID_AMOUNT" : "INVALID_CLOCK");
  }
  const postedTime = hasValidPostedAt(context.postedAt);
  const occurredLocalTime = postedTime ? received.localTime : "00:00";
  const occurrence = embeddedOccurrence({
    context,
    month: summary[1],
    day: summary[2],
    hour: occurredLocalTime.slice(0, 2),
    minute: occurredLocalTime.slice(3, 5),
  });
  if (occurrence.kind === "failure") return ignoredParseFailure(occurrence.code);
  return parsedPayment({
    type: "approval",
    amountInWon: amount,
    occurredLocalDate: occurrence.occurredLocalDate,
    occurredLocalTime,
    merchant: summary[5].trim(),
    cardCompany: "국민",
    maskedCardToken: summary[4],
    ...(postedTime ? { timeSource: "postedAt" as const } : {}),
  });
}

function parseNh(context: ProviderParserContext): AndroidProviderParseResult {
  const match = flattenedBody(context.body).match(
    /^NH카드\s+(승인취소|승인)\s+([\d,]+)원\s+(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})\s+농협\s*([\d*]{4,})\s+(.+)$/u,
  );
  if (match === null) return ignoredParseFailure();
  const amount = amountInWon(match[2]);
  const occurrence = occurrenceFromMatch(context, match, {
    month: 3,
    day: 4,
    hour: 5,
    minute: 6,
  });
  if (amount === undefined || occurrence.kind === "failure") {
    return ignoredParseFailure(
      occurrence.kind === "failure" ? occurrence.code : "INVALID_AMOUNT",
    );
  }
  const token = match[7].replace(/\D/gu, "").slice(-4);
  return parsedPayment({
    type: match[1] === "승인취소" ? "cancellation" : "approval",
    amountInWon: amount,
    occurredLocalDate: occurrence.occurredLocalDate,
    occurredLocalTime: occurrence.occurredLocalTime,
    merchant: match[8].trim(),
    cardCompany: "농협",
    ...(token === "" ? {} : { maskedCardToken: token }),
  });
}

function parsePaybooc(
  context: ProviderParserContext,
): AndroidProviderParseResult {
  const body = flattenedBody(context.body);
  const card = body.match(/^(.+?)카드\((\d{4})\)\s+/u);
  const action = body.match(/\s(매출취소|승인)\s/u);
  const amountMatch = body.match(/\s([\d,]+)원\s/u);
  const dateTime = /(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/u.exec(body);
  if (card === null || action === null || amountMatch === null || dateTime === null) {
    return ignoredParseFailure();
  }
  const amount = amountInWon(amountMatch[1]);
  if (amount === undefined || amount <= 0) {
    return { kind: "Rejected", code: "AMOUNT_NOT_POSITIVE" };
  }
  const merchant = body.slice((dateTime.index ?? 0) + dateTime[0].length).trim();
  if (merchant === "") return { kind: "Rejected", code: "MERCHANT_REQUIRED" };
  const occurrence = occurrenceFromMatch(context, dateTime, {
    month: 1,
    day: 2,
    hour: 3,
    minute: 4,
  });
  if (occurrence.kind === "failure") return ignoredParseFailure(occurrence.code);
  return parsedPayment({
    type: action[1] === "매출취소" ? "cancellation" : "approval",
    amountInWon: amount,
    occurredLocalDate: occurrence.occurredLocalDate,
    occurredLocalTime: occurrence.occurredLocalTime,
    merchant,
    cardCompany: card[1].trim(),
    maskedCardToken: card[2],
  });
}

function parseLeadingCardNotification(input: {
  readonly context: ProviderParserContext;
  readonly label: "삼성" | "롯데";
  readonly supportsInstallment: boolean;
}): AndroidProviderParseResult {
  const escapedLabel = input.label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = flattenedBody(input.context.body).match(
    new RegExp(
      `^${escapedLabel}\\((\\d{4})\\)\\s+(승인취소|승인)\\s+([\\d,]+)원\\s+(\\d{1,2})\\/(\\d{1,2})\\s+(\\d{1,2}):(\\d{2})\\s+(.+)$`,
      "u",
    ),
  );
  if (match === null) return ignoredParseFailure();
  const amount = amountInWon(match[3]);
  const occurrence = occurrenceFromMatch(input.context, match, {
    month: 4,
    day: 5,
    hour: 6,
    minute: 7,
  });
  if (amount === undefined || occurrence.kind === "failure") {
    return ignoredParseFailure(
      occurrence.kind === "failure" ? occurrence.code : "INVALID_AMOUNT",
    );
  }
  let merchant = match[8].trim();
  let installmentMonths: number | undefined;
  if (input.supportsInstallment && match[2] === "승인") {
    const installment = merchant.match(/^(\d+)개월\s+할부\s+(.+)$/u);
    if (installment !== null) {
      installmentMonths = Number(installment[1]);
      merchant = installment[2].trim();
    }
  }
  return parsedPayment({
    type: match[2] === "승인취소" ? "cancellation" : "approval",
    amountInWon: amount,
    occurredLocalDate: occurrence.occurredLocalDate,
    occurredLocalTime: occurrence.occurredLocalTime,
    merchant,
    cardCompany: input.label,
    maskedCardToken: match[1],
    ...(installmentMonths === undefined ? {} : { installmentMonths }),
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
  supportedPackages: ["com.samsung.android.spay"],
  parse: (context) =>
    parseLeadingCardNotification({
      context,
      label: "삼성",
      supportsInstallment: false,
    }),
};

export const lotteCardProviderParser: ProviderParserDefinition = {
  parserId: "lotte-card-parser",
  supportedPackages: ["com.lcacApp"],
  parse: (context) =>
    parseLeadingCardNotification({
      context,
      label: "롯데",
      supportsInstallment: true,
    }),
};
