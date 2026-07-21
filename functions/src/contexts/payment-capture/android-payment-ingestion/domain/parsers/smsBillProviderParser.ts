import type { AndroidProviderParseResult } from "../model/androidProviderParser";
import {
  amountInWon,
  flattenedBody,
  paymentAtReceivedTime,
  type ProviderParserContext,
  type ProviderParserDefinition,
} from "./providerParsingSupport";

function parseSmsBill(
  context: ProviderParserContext,
): AndroidProviderParseResult {
  const match = flattenedBody(context.body).match(
    /^\[NH카드\]\s+(.+?)\s+([\d,]+)원\s+정상\s+납부\s+완료$/u,
  );
  if (match === null) {
    return { kind: "Ignored", code: "NOT_COMPLETED_PAYMENT" };
  }
  const amount = amountInWon(match[2]);
  if (amount === undefined || amount <= 0) {
    return { kind: "Rejected", code: "AMOUNT_NOT_POSITIVE" };
  }
  return paymentAtReceivedTime({
    context,
    payment: {
      type: "approval",
      amountInWon: amount,
      merchant: match[1].trim(),
      cardCompany: "농협",
    },
  });
}

export const smsBillProviderParser: ProviderParserDefinition = {
  parserId: "sms-card-message-parser",
  supportedPackages: ["com.google.android.apps.messaging"],
  parse: parseSmsBill,
};
