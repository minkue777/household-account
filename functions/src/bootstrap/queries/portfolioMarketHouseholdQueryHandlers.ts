import type {
  PortfolioMarketQuotePort,
  PortfolioMarketTarget,
} from "../../contexts/portfolio/core/application/ports/out/portfolioRuntimeStorePort";
import {
  HouseholdQueryRejection,
  requireHouseholdReadScope,
  type HouseholdQueryHandler,
} from "./householdQuery";

export type PortfolioQueryMarket =
  | "KRX"
  | "US"
  | "KOFIA_FUND"
  | "UPBIT_KRW"
  | "PHYSICAL_GOLD";

export type PortfolioQueryInstrumentType =
  | "stock"
  | "etf"
  | "etn"
  | "fund"
  | "crypto"
  | "gold";

export interface PortfolioInstrumentQueryView {
  readonly market: PortfolioQueryMarket;
  readonly instrumentType: PortfolioQueryInstrumentType;
  readonly code: string;
  readonly name: string;
  readonly priceScale?: number;
}

export type PortfolioInstrumentSearchGatewayResult =
  | {
      readonly kind: "success";
      readonly items: readonly PortfolioInstrumentQueryView[];
      readonly truncated: boolean;
      readonly stale: boolean;
      readonly catalogAsOf?: string;
      readonly catalogVersion?: string;
    }
  | {
      readonly kind: "failure";
      readonly code: string;
      readonly retryable: boolean;
    };

export interface PortfolioInstrumentSearchGateway {
  search(input: {
    readonly assetClass: "stock" | "crypto";
    readonly query: string;
    readonly limit: number;
    readonly now: string;
  }): Promise<PortfolioInstrumentSearchGatewayResult>;
}

export interface PortfolioDividendProjectionView {
  readonly code: string;
  readonly name: string;
  readonly recentDividend: number | null;
  readonly paymentDate: string | null;
  readonly frequency: number | null;
  readonly dividendYield: number | null;
  readonly annualDividendPerShare: number | null;
  readonly isEstimated: false;
  readonly paymentEvents: readonly {
    readonly paymentDate: string;
    readonly dividend: number;
  }[];
}

export interface PortfolioDividendProjectionReader {
  read(input: {
    readonly householdId: string;
    readonly instrumentCode: string;
    readonly asOfDate: string;
  }): Promise<PortfolioDividendProjectionView>;
}

const MARKETS = new Set<PortfolioQueryMarket>([
  "KRX",
  "US",
  "KOFIA_FUND",
  "UPBIT_KRW",
  "PHYSICAL_GOLD",
]);
const INSTRUMENT_TYPES = new Set<PortfolioQueryInstrumentType>([
  "stock",
  "etf",
  "etn",
  "fund",
  "crypto",
  "gold",
]);

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return required.every((key) =>
    Object.prototype.hasOwnProperty.call(value, key),
  ) &&
    keys.every((key) => allowed.has(key));
}

function boundedText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximum
    ? normalized
    : undefined;
}

function searchPayload(payload: Readonly<Record<string, unknown>>) {
  if (!exactKeys(payload, ["assetClass", "query"], ["limit"])) return undefined;
  const assetClass = payload.assetClass;
  const query = boundedText(payload.query, 100);
  const limit = payload.limit ?? 10;
  if (
    (assetClass !== "stock" && assetClass !== "crypto") ||
    query === undefined ||
    typeof limit !== "number" ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 10
  ) {
    return undefined;
  }
  return { assetClass, query, limit } as const;
}

function quotePayload(payload: Readonly<Record<string, unknown>>) {
  if (
    !exactKeys(payload, ["market", "code"], [
      "name",
      "instrumentType",
      "priceScale",
    ])
  ) {
    return undefined;
  }
  const market = payload.market;
  const code = boundedText(payload.code, 64);
  const name = payload.name === undefined ? code : boundedText(payload.name, 200);
  const instrumentType = payload.instrumentType ?? defaultInstrumentType(market);
  const priceScale = payload.priceScale ?? (market === "KOFIA_FUND" ? 1_000 : 1);
  if (
    typeof market !== "string" ||
    !MARKETS.has(market as PortfolioQueryMarket) ||
    code === undefined ||
    name === undefined ||
    typeof instrumentType !== "string" ||
    !INSTRUMENT_TYPES.has(instrumentType as PortfolioQueryInstrumentType) ||
    typeof priceScale !== "number" ||
    !Number.isFinite(priceScale) ||
    priceScale <= 0
  ) {
    return undefined;
  }
  return {
    market: market as PortfolioQueryMarket,
    code,
    name,
    instrumentType: instrumentType as PortfolioQueryInstrumentType,
    priceScale,
  };
}

function defaultInstrumentType(market: unknown): PortfolioQueryInstrumentType {
  if (market === "KOFIA_FUND") return "fund";
  if (market === "UPBIT_KRW") return "crypto";
  if (market === "PHYSICAL_GOLD") return "gold";
  return "stock";
}

function marketTarget(
  queryId: string,
  input: ReturnType<typeof quotePayload> & {},
): PortfolioMarketTarget {
  return {
    targetKey: `query:${queryId}`,
    assetId: `query:${queryId}`,
    kind:
      input.market === "UPBIT_KRW"
        ? "crypto"
        : input.market === "PHYSICAL_GOLD"
          ? "physical-gold"
          : "stock",
    market: input.market,
    instrumentCode: input.code,
    quantity: 0,
    priceScale: input.priceScale,
  };
}

function seoulDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function createPortfolioMarketHouseholdQueryHandlers(input: {
  readonly search: PortfolioInstrumentSearchGateway;
  readonly quotes: PortfolioMarketQuotePort;
  readonly dividends: PortfolioDividendProjectionReader;
  readonly now?: () => Date;
}): ReadonlyMap<string, HouseholdQueryHandler> {
  const now = input.now ?? (() => new Date());
  return new Map<string, HouseholdQueryHandler>([
    [
      "portfolio.search-instruments.v1",
      {
        async execute(context) {
          const parsed = searchPayload(context.envelope.payload);
          if (parsed === undefined) {
            throw new HouseholdQueryRejection("INVALID_PAYLOAD");
          }
          const result = await input.search.search({
            ...parsed,
            now: now().toISOString(),
          });
          if (result.kind === "failure") {
            throw new HouseholdQueryRejection(result.code, result.retryable);
          }
          return {
            items: result.items,
            truncated: result.truncated,
            stale: result.stale,
            ...(result.catalogAsOf === undefined
              ? {}
              : { catalogAsOf: result.catalogAsOf }),
            ...(result.catalogVersion === undefined
              ? {}
              : { catalogVersion: result.catalogVersion }),
          };
        },
      },
    ],
    [
      "portfolio.get-instrument-quote.v1",
      {
        async execute(context) {
          const parsed = quotePayload(context.envelope.payload);
          if (parsed === undefined) {
            throw new HouseholdQueryRejection("INVALID_PAYLOAD");
          }
          const result = await input.quotes.getQuote(
            marketTarget(context.envelope.queryId, parsed),
          );
          if (result.kind === "failure") {
            throw new HouseholdQueryRejection(result.code, result.retryable);
          }
          return {
            instrument: {
              market: parsed.market,
              instrumentType: parsed.instrumentType,
              code: parsed.code,
              name: parsed.name,
              priceScale: parsed.priceScale,
            },
            priceInWon: result.quote.priceInWon,
            observedAt: result.quote.observedAt,
            provider: result.quote.provider,
            ...(result.quoteAsOf === undefined
              ? {}
              : { quoteAsOf: result.quoteAsOf }),
          };
        },
      },
    ],
    [
      "portfolio.get-dividend-projection.v1",
      {
        async execute(context) {
          const payload = context.envelope.payload;
          const instrumentCode = exactKeys(payload, ["instrumentCode"])
            ? boundedText(payload.instrumentCode, 64)
            : undefined;
          if (instrumentCode === undefined) {
            throw new HouseholdQueryRejection("INVALID_PAYLOAD");
          }
          const scope = requireHouseholdReadScope(context);
          return input.dividends.read({
            householdId: scope.householdId,
            instrumentCode,
            asOfDate: seoulDate(now()),
          });
        },
      },
    ],
  ]);
}
