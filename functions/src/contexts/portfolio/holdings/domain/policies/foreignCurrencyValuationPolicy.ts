import type {
  ExchangeRateObservation,
  SourceQuoteObservation,
  WonValuationQuote,
} from "../model/foreignCurrencyValuation";

export type ExchangeRateParseResult =
  | { kind: "success"; value: ExchangeRateObservation }
  | { kind: "failure"; code: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLocalDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3])
  );
}

export function parseFrankfurterRate(input: {
  body: unknown;
  observedAt: string;
  asOfDate: string;
}): ExchangeRateParseResult {
  if (!isObject(input.body)) {
    return { kind: "failure", code: "EXCHANGE_RATE_SCHEMA_CHANGED" };
  }
  if (input.body.base !== "USD" || input.body.quote !== "KRW") {
    return { kind: "failure", code: "INVALID_EXCHANGE_RATE_PAIR" };
  }
  if (!isLocalDate(input.body.date)) {
    return { kind: "failure", code: "EXCHANGE_RATE_SCHEMA_CHANGED" };
  }
  if (input.body.date > input.asOfDate) {
    return { kind: "failure", code: "INVALID_EXCHANGE_RATE_DATE" };
  }
  if (
    typeof input.body.rate !== "number" ||
    !Number.isFinite(input.body.rate) ||
    input.body.rate <= 0
  ) {
    return { kind: "failure", code: "INVALID_EXCHANGE_RATE" };
  }
  return {
    kind: "success",
    value: {
      pair: "USD/KRW",
      rate: input.body.rate,
      rateDate: input.body.date,
      observedAt: input.observedAt,
      provider: "frankfurter-v2",
    },
  };
}

export function valueSourceQuoteInWon(
  quote: SourceQuoteObservation,
  rate: ExchangeRateObservation,
): WonValuationQuote {
  return {
    priceInWon: quote.sourcePrice * rate.rate,
    previousCloseInWon: quote.sourcePreviousClose * rate.rate,
    quoteObservedAt: quote.observedAt,
    quoteProvider: quote.provider,
    exchangeRateDate: rate.rateDate,
    exchangeRateObservedAt: rate.observedAt,
    exchangeRateProvider: rate.provider,
  };
}
