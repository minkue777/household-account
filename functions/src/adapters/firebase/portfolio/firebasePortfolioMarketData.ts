import type {
  PortfolioMarketQuotePort,
  PortfolioMarketQuoteResult,
  PortfolioMarketTarget,
} from "../../../contexts/portfolio/core/application/ports/out/portfolioRuntimeStorePort";
import { NodeExternalTextHttpTransport } from "../../http/nodeExternalTextHttpTransport";
import { createSafeExternalTextHttpApplication } from "../../../platform/external-operations/application/safeExternalTextHttpApplication";
import type {
  SafeExternalTextHttpInputPort,
  SafeExternalTextHttpResult,
} from "../../../platform/external-operations/application/ports/in/safeExternalTextHttpInputPort";
import { isKrxGoldSpotCode, parseFrankfurterRate, type ExchangeRateObservation } from "../../../contexts/portfolio/holdings/public";
import { parseLocalDate, resolveSeoulMonthBoundary } from "../../../platform/shared-kernel/seoulDateTime";
import { FirebasePortfolioQuoteObservations, type SourceMarketObservation } from "./firebasePortfolioQuoteObservations";

const NATIONAL_GROWTH_FUND_CODES = new Set([
  "FUND:K55301EW0012",
  "K55301EW0012",
  "EW001",
]);
const NATIONAL_GROWTH_FUND_PRICE_URL =
  "https://investments.miraeasset.com/magi/fund/basePrices.do?fundGb=2&fundCd=539502&period=1M";
const NAVER_GOLD_URL = "https://m.stock.naver.com/marketindex/metals/M04020000";
const FRANKFURTER_USD_KRW_URL =
  "https://api.frankfurter.dev/v2/rate/USD/KRW";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 HouseholdAccount/1.0";
const REQUEST_TIMEOUT_MILLIS = 10_000;
const DON_TO_GRAM = 3.75;

function failure(
  code: string,
  retryable: boolean,
  provider?: string,
): PortfolioMarketQuoteResult {
  return {
    kind: "failure",
    code,
    retryable,
    ...(provider === undefined ? {} : { provider }),
  };
}

function numberFromText(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const parsed = Number(String(value).replace(/[^0-9.+-]/gu, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function defaultSafeHttp(): SafeExternalTextHttpInputPort {
  return createSafeExternalTextHttpApplication({
    policy: {
      providers: [
        {
          provider: "naver-domestic",
          allowedHosts: ["m.stock.naver.com"],
          allowedPorts: [443],
          maxRedirectHops: 2,
        },
        {
          provider: "nasdaq-us",
          allowedHosts: ["api.nasdaq.com"],
          allowedPorts: [443],
          maxRedirectHops: 2,
        },
        {
          provider: "frankfurter-v2",
          allowedHosts: ["api.frankfurter.dev"],
          allowedPorts: [443],
          maxRedirectHops: 2,
        },
        {
          provider: "upbit",
          allowedHosts: ["api.upbit.com"],
          allowedPorts: [443],
          maxRedirectHops: 2,
        },
        {
          provider: "miraeasset-fund-nav",
          allowedHosts: ["investments.miraeasset.com"],
          allowedPorts: [443],
          maxRedirectHops: 2,
        },
        {
          provider: "naver-krx-gold-market",
          allowedHosts: ["m.stock.naver.com"],
          allowedPorts: [443],
          maxRedirectHops: 2,
        },
      ],
      timeoutMs: REQUEST_TIMEOUT_MILLIS,
      // Portfolio application owns the three-attempt contract.
      maxAttempts: 1,
      maxResponseBytes: 2 * 1024 * 1024,
    },
    transport: new NodeExternalTextHttpTransport(),
  });
}

function httpFailure(
  result: Exclude<SafeExternalTextHttpResult, { readonly kind: "success" }>,
  provider: string,
): PortfolioMarketQuoteResult {
  if (result.kind === "retryable-failure") {
    return failure(result.code, true, provider);
  }
  return failure(result.code, false, provider);
}

function parseLatestFundNav(html: string, asOfDate: string):
  | { readonly date: string; readonly nav: number }
  | undefined {
  const quotes: { date: string; nav: number }[] = [];
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/giu;
  const cellPattern = /<td[^>]*>([\s\S]*?)<\/td>/giu;
  let row: RegExpExecArray | null;
  while ((row = rowPattern.exec(html)) !== null) {
    const cells: string[] = [];
    cellPattern.lastIndex = 0;
    let cell: RegExpExecArray | null;
    while ((cell = cellPattern.exec(row[1])) !== null) {
      cells.push(
        cell[1]
          .replace(/<[^>]+>/gu, "")
          .replace(/&nbsp;/giu, " ")
          .trim(),
      );
    }
    const dateMatch = /^(\d{4})[.-](\d{2})[.-](\d{2})$/u.exec(cells[0] ?? "");
    const nav = numberFromText(cells[1]);
    if (dateMatch !== null && nav !== undefined) {
      const date = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
      if (date > asOfDate || parseLocalDate(date).kind !== "success") continue;
      quotes.push({
        date,
        nav,
      });
    }
  }
  quotes.sort((left, right) => right.date.localeCompare(left.date));
  return quotes[0];
}

function parseGoldPricePerGram(html: string): number | undefined {
  const nextDataMatch =
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/u.exec(
      html,
    );
  if (nextDataMatch?.[1] !== undefined) {
    try {
      const payload = JSON.parse(nextDataMatch[1]) as {
        props?: {
          pageProps?: {
            dehydratedState?: {
              queries?: Array<{
                state?: { data?: { result?: { closePrice?: unknown } } };
              }>;
            };
          };
        };
      };
      const price = payload.props?.pageProps?.dehydratedState?.queries
        ?.map((query) => query.state?.data?.result?.closePrice)
        .map(numberFromText)
        .find((value): value is number => value !== undefined);
      if (price !== undefined) return price;
    } catch {
      // The validated HTML fallback below remains available for schema changes.
    }
  }
  const match =
    /<strong[^>]*>국내\s+금<\/strong>[\s\S]*?<strong[^>]*>([\d,]+)<span[^>]*>원\/g<\/span><\/strong>/u.exec(
      html,
    );
  return numberFromText(match?.[1]);
}

function successQuote(input: {
  readonly priceInWon: number;
  readonly provider: string;
  readonly observedAt?: string;
  readonly quoteAsOf?: string;
}): PortfolioMarketQuoteResult {
  if (!Number.isFinite(input.priceInWon) || input.priceInWon < 0) {
    return failure("INVALID_PROVIDER_DATA", false);
  }
  return {
    kind: "success",
    quote: {
      priceInWon: input.priceInWon,
      observedAt: input.observedAt ?? new Date().toISOString(),
      provider: input.provider,
    },
    ...(input.quoteAsOf === undefined ? {} : { quoteAsOf: input.quoteAsOf }),
  };
}

interface CachedExchangeRate {
  readonly fetchedAt: number;
  readonly rate: number;
  readonly rateDate: string;
  readonly observedAt: string;
}

export class FirebasePortfolioMarketData implements PortfolioMarketQuotePort {
  private cachedExchangeRate?: CachedExchangeRate;

  constructor(private readonly http: SafeExternalTextHttpInputPort = defaultSafeHttp(), private readonly observations?: FirebasePortfolioQuoteObservations) {}

  async getQuote(
    target: PortfolioMarketTarget,
  ): Promise<PortfolioMarketQuoteResult> {
    switch (target.market) {
      case "KRX":
        return isKrxGoldSpotCode(target.instrumentCode)
          ? this.krxGoldSpot()
          : this.domesticStock(target.instrumentCode);
      case "US":
        return this.usStock(target.instrumentCode);
      case "KOFIA_FUND":
        return this.fund(target.instrumentCode);
      case "UPBIT_KRW":
        return this.crypto(target.instrumentCode);
      case "PHYSICAL_GOLD":
        return this.physicalGold();
    }
  }

  private async domesticStock(code: string): Promise<PortfolioMarketQuoteResult> {
    const response = await this.http.execute({
      provider: "naver-domestic",
      operation: "market-quote",
      url: `https://m.stock.naver.com/api/stock/${encodeURIComponent(code)}/basic`,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (response.kind !== "success") {
      return httpFailure(response, "naver-domestic");
    }
    try {
      const payload = JSON.parse(response.body) as { closePrice?: unknown };
      const price = numberFromText(payload.closePrice);
      return price === undefined
        ? failure("MARKET_SCHEMA_CHANGED", false, "naver-domestic")
        : successQuote({ priceInWon: Math.round(price), provider: "naver-domestic" });
    } catch {
      return failure("MARKET_SCHEMA_CHANGED", false, "naver-domestic");
    }
  }

  private async fund(code: string): Promise<PortfolioMarketQuoteResult> {
    if (!NATIONAL_GROWTH_FUND_CODES.has(code.toLocaleUpperCase("en-US"))) {
      return failure("INSTRUMENT_NOT_FOUND", false, "miraeasset-fund-nav");
    }
    const response = await this.http.execute({
      provider: "miraeasset-fund-nav",
      operation: "fund-nav",
      url: NATIONAL_GROWTH_FUND_PRICE_URL,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (response.kind !== "success") {
      return httpFailure(response, "miraeasset-fund-nav");
    }
    const quote = parseLatestFundNav(response.body, resolveSeoulMonthBoundary({ instant: new Date().toISOString(), zoneId: "Asia/Seoul" }).localDate);
    return quote === undefined
      ? failure("MARKET_SCHEMA_CHANGED", false, "miraeasset-fund-nav")
      : successQuote({
          priceInWon: quote.nav,
          provider: "miraeasset-fund-nav",
          quoteAsOf: quote.date,
        });
  }

  private async crypto(market: string): Promise<PortfolioMarketQuoteResult> {
    const response = await this.http.execute({
      provider: "upbit",
      operation: "market-quote",
      url: `https://api.upbit.com/v1/ticker?markets=${encodeURIComponent(market)}`,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (response.kind !== "success") return httpFailure(response, "upbit");
    try {
      const payload = JSON.parse(response.body) as Array<{
        trade_price?: unknown;
        timestamp?: unknown;
      }>;
      const price = numberFromText(payload[0]?.trade_price);
      const timestamp = payload[0]?.timestamp;
      return price === undefined
        ? failure("MARKET_SCHEMA_CHANGED", false, "upbit")
        : successQuote({
            priceInWon: price,
            provider: "upbit",
            ...(typeof timestamp === "number" && Number.isFinite(timestamp)
              ? { observedAt: new Date(timestamp).toISOString() }
              : {}),
          });
    } catch {
      return failure("MARKET_SCHEMA_CHANGED", false, "upbit");
    }
  }

  private async physicalGold(): Promise<PortfolioMarketQuoteResult> {
    return this.goldMarketQuote(DON_TO_GRAM);
  }

  private async krxGoldSpot(): Promise<PortfolioMarketQuoteResult> {
    return this.goldMarketQuote(1);
  }

  private async goldMarketQuote(
    gramMultiplier: number,
  ): Promise<PortfolioMarketQuoteResult> {
    const response = await this.http.execute({
      provider: "naver-krx-gold-market",
      operation: "market-quote",
      url: NAVER_GOLD_URL,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (response.kind !== "success") {
      return httpFailure(response, "naver-krx-gold-market");
    }
    const pricePerGram = parseGoldPricePerGram(response.body);
    return pricePerGram === undefined
      ? failure("MARKET_SCHEMA_CHANGED", false, "naver-krx-gold-market")
      : successQuote({
          priceInWon: pricePerGram * gramMultiplier,
          provider: "naver-krx-gold-market",
        });
  }

  private async usStock(code: string): Promise<PortfolioMarketQuoteResult> {
    const symbol = code.replace(/^US:/u, "").trim().toLocaleUpperCase("en-US");
    if (symbol === "") return failure("INSTRUMENT_NOT_FOUND", false, "nasdaq-us");
    const headers = {
      Accept: "application/json, text/plain, */*",
      Origin: "https://www.nasdaq.com",
      Referer: "https://www.nasdaq.com/",
    };
    let quote: SourceMarketObservation | undefined;
    let lastFailure: PortfolioMarketQuoteResult = failure(
      "QUOTE_NOT_PUBLISHED",
      false,
      "nasdaq-us",
    );
    for (const assetClass of ["stocks", "etf"] as const) {
      const response = await this.http.execute({
        provider: "nasdaq-us",
        operation: "market-quote",
        url: `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/info?assetclass=${assetClass}`,
        headers: { "User-Agent": USER_AGENT, ...headers },
      });
      if (response.kind !== "success") {
        lastFailure = httpFailure(response, "nasdaq-us");
        continue;
      }
      try {
        const payload = JSON.parse(response.body) as {
          data?: {
            primaryData?: { lastSalePrice?: unknown };
            secondaryData?: { lastSalePrice?: unknown };
          };
        };
        const sourcePrice =
          numberFromText(payload.data?.primaryData?.lastSalePrice) ??
          numberFromText(payload.data?.secondaryData?.lastSalePrice);
        if (sourcePrice !== undefined) {
          quote = { sourcePrice, observedAt: new Date().toISOString(), provider: "nasdaq-us" };
          break;
        }
        lastFailure = failure("MARKET_SCHEMA_CHANGED", false, "nasdaq-us");
      } catch {
        lastFailure = failure("MARKET_SCHEMA_CHANGED", false, "nasdaq-us");
      }
    }
    const providerFailures: { kind: "failure"; code: string; retryable: boolean; provider: string }[] = [];
    if (quote !== undefined) quote = await this.observations?.saveSource(symbol, quote) ?? quote;
    else {
      if (lastFailure.kind === "failure") providerFailures.push({ ...lastFailure, provider: "nasdaq-us" });
      quote = await this.observations?.source(symbol);
    }
    const observedRate = await this.usdKrwRate();
    let rate: ExchangeRateObservation | undefined;
    if (observedRate.kind === "success") {
      const candidate: ExchangeRateObservation = { pair: "USD/KRW", rate: observedRate.rate, rateDate: observedRate.rateDate, observedAt: observedRate.observedAt, provider: "frankfurter-v2" };
      rate = await this.observations?.saveRate(candidate) ?? candidate;
    } else {
      providerFailures.push({ ...observedRate, provider: "frankfurter-v2" });
      rate = await this.observations?.rate();
      if (rate === undefined && this.cachedExchangeRate !== undefined) rate = { ...this.cachedExchangeRate, pair: "USD/KRW", provider: "frankfurter-v2" };
    }
    if (quote === undefined) return lastFailure;
    if (rate === undefined) return failure("EXCHANGE_RATE_NOT_OBSERVED", observedRate.kind === "failure" && observedRate.retryable, "frankfurter-v2");
    return {
      kind: "success",
      quote: { priceInWon: quote.sourcePrice * rate.rate, provider: "nasdaq-us+frankfurter-v2", observedAt: quote.observedAt,
        sourcePrice: quote.sourcePrice, sourceCurrency: "USD", quoteProvider: quote.provider, quoteObservedAt: quote.observedAt,
        exchangeRateDate: rate.rateDate, exchangeRateObservedAt: rate.observedAt, exchangeRateProvider: rate.provider },
      quoteAsOf: rate.rateDate,
      ...(providerFailures.length === 0 ? {} : { providerFailures }),
    };
  }

  private async usdKrwRate(): Promise<
    | { readonly kind: "success"; readonly rate: number; readonly rateDate: string; readonly observedAt: string }
    | Extract<PortfolioMarketQuoteResult, { readonly kind: "failure" }>
  > {
    if (
      this.cachedExchangeRate !== undefined &&
      Date.now() - this.cachedExchangeRate.fetchedAt < 5 * 60 * 1_000
    ) {
      return {
        kind: "success",
        rate: this.cachedExchangeRate.rate,
        rateDate: this.cachedExchangeRate.rateDate,
        observedAt: this.cachedExchangeRate.observedAt,
      };
    }
    const response = await this.http.execute({
      provider: "frankfurter-v2",
      operation: "exchange-rate",
      url: FRANKFURTER_USD_KRW_URL,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (response.kind !== "success") {
      return httpFailure(response, "frankfurter-v2") as Extract<
        PortfolioMarketQuoteResult,
        { readonly kind: "failure" }
      >;
    }
    try {
      const payload = JSON.parse(response.body) as {
        date?: unknown;
        base?: unknown;
        quote?: unknown;
        rate?: unknown;
      };
      const observedAt = new Date().toISOString();
      const parsed = parseFrankfurterRate({ body: payload, observedAt, asOfDate: resolveSeoulMonthBoundary({ instant: observedAt, zoneId: "Asia/Seoul" }).localDate });
      if (parsed.kind === "failure") {
        return {
          kind: "failure",
          code: parsed.code,
          retryable: false,
          provider: "frankfurter-v2",
        };
      }
      this.cachedExchangeRate = {
        fetchedAt: Date.now(),
        rate: parsed.value.rate,
        rateDate: parsed.value.rateDate,
        observedAt,
      };
      return { kind: "success", rate: parsed.value.rate, rateDate: parsed.value.rateDate, observedAt };
    } catch {
      return {
        kind: "failure",
        code: "MARKET_SCHEMA_CHANGED",
        retryable: false,
        provider: "frankfurter-v2",
      };
    }
  }
}
