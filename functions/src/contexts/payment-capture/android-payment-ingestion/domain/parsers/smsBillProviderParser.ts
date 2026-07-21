import type { AndroidProviderParseResult } from "../model/androidProviderParser";
import {
  amountInWon,
  bodyLines,
  ignoredParseFailure,
  paymentAtReceivedTime,
  type ProviderParserContext,
  type ProviderParserDefinition,
} from "./providerParsingSupport";
import {
  kbCardProviderParser,
  lotteCardProviderParser,
  nhPayProviderParser,
  payboocProviderParser,
  samsungCardProviderParser,
} from "./cardProviderParsers";
import {
  daejeonLocalCurrencyProviderParser,
  gyeonggiLocalCurrencyProviderParser,
} from "./localCurrencyProviderParsers";
import {
  digitalOnnuriProviderParser,
  kakaoPayProviderParser,
  naverPayProviderParser,
  tossBankProviderParser,
} from "./walletProviderParsers";

const NH_SENDER_PATTERN = /^\[NH농협카드\]$/u;
const NH_BILLING_PATTERN = /(\d{2})월분\s+(.+?)\s+([\d,]+)원/u;
const NH_COMPLETION_PATTERN = /카드\s*정상\(승인\)납부\s*완료\.?/u;

const SMS_PAYMENT_PARSERS: readonly ProviderParserDefinition[] = [
  kbCardProviderParser,
  nhPayProviderParser,
  naverPayProviderParser,
  tossBankProviderParser,
  kakaoPayProviderParser,
  digitalOnnuriProviderParser,
  payboocProviderParser,
  samsungCardProviderParser,
  lotteCardProviderParser,
  gyeonggiLocalCurrencyProviderParser,
  daejeonLocalCurrencyProviderParser,
];

function smsCandidates(value: string): readonly string[] {
  const lines = bodyLines(value);
  const candidates = new Set<string>();
  if (lines.length > 0) candidates.add(lines.join("\n"));
  if (lines.length >= 2) candidates.add(lines.slice(1).join("\n"));
  if (lines.length >= 3) candidates.add(lines.slice(2).join("\n"));
  return [...candidates].map((candidate) => candidate.trim()).filter(Boolean);
}

function parseNhBill(
  context: ProviderParserContext,
): AndroidProviderParseResult {
  const lines = bodyLines(context.body);
  if (
    !lines.some((line) => NH_SENDER_PATTERN.test(line)) ||
    !lines.some((line) => NH_COMPLETION_PATTERN.test(line))
  ) {
    return ignoredParseFailure("NOT_COMPLETED_PAYMENT");
  }
  const amountIndex = lines.findIndex((line) => NH_BILLING_PATTERN.test(line));
  if (amountIndex < 0) return ignoredParseFailure("NOT_COMPLETED_PAYMENT");
  const match = NH_BILLING_PATTERN.exec(lines[amountIndex]);
  if (match === null) return ignoredParseFailure("NOT_COMPLETED_PAYMENT");
  const amount = amountInWon(match[3]);
  if (amount === undefined) return ignoredParseFailure("INVALID_AMOUNT");
  const billingLabel = `${match[1]}월분 ${match[2].trim()}`;
  const merchant = billingLabel.includes("관리비")
    ? billingLabel
    : [
        ...lines
          .slice(0, amountIndex)
          .filter((line) => line !== "[Web발신]" && !NH_SENDER_PATTERN.test(line)),
        billingLabel,
      ].join(" ").trim() || billingLabel;
  return paymentAtReceivedTime({
    context,
    payment: {
      type: "approval",
      amountInWon: amount,
      merchant,
      cardCompany: "농협",
    },
  });
}

function parseSms(context: ProviderParserContext): AndroidProviderParseResult {
  for (const candidate of smsCandidates(context.body)) {
    const candidateContext = { ...context, body: candidate };
    for (const parser of SMS_PAYMENT_PARSERS) {
      const result = parser.parse(candidateContext);
      if (result.kind === "Parsed" && result.payment !== undefined) {
        return { kind: "Parsed", payment: result.payment };
      }
    }
    const bill = parseNhBill(candidateContext);
    if (bill.kind === "Parsed") return bill;
  }
  return ignoredParseFailure("NOT_COMPLETED_PAYMENT");
}

export const smsBillProviderParser: ProviderParserDefinition = {
  parserId: "sms-card-message-parser",
  supportedPackages: [
    "com.google.android.apps.messaging",
    "com.samsung.android.messaging",
    "com.android.mms",
  ],
  parse: parseSms,
};
