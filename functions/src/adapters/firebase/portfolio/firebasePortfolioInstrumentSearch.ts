import { createInstrumentSearchApplication } from "../../../contexts/portfolio/holdings/application/instrumentSearchApplication";
import type { InstrumentCatalog } from "../../../contexts/portfolio/holdings/application/ports/in/instrumentCatalog";
import type { InstrumentCatalogReader } from "../../../contexts/portfolio/holdings/application/ports/out/instrumentCatalogReader";
import type {
  InstrumentSearchResult,
  SearchInstrument,
} from "../../../contexts/portfolio/holdings/domain/model/instrumentSearch";
import { createSafeExternalTextHttpApplication } from "../../../platform/external-operations/application/safeExternalTextHttpApplication";
import type { SafeExternalTextHttpInputPort } from "../../../platform/external-operations/application/ports/in/safeExternalTextHttpInputPort";
import { NodeExternalTextHttpTransport } from "../../http/nodeExternalTextHttpTransport";

const UPBIT_MARKETS_URL =
  "https://api.upbit.com/v1/market/all?isDetails=false";
const CRYPTO_CACHE_MILLISECONDS = 10 * 60 * 1_000;
const NATIONAL_GROWTH_FUND: SearchInstrument = {
  market: "KRX",
  instrumentType: "ETF",
  code: "FUND:K55301EW0012",
  name: "미래에셋국민참여형국민성장혼합자산투자신탁(사모투자재간접형) 종류 C-e",
  aliases: ["국민성장펀드", "국민성장", "EW001", "539500", "539502"],
  priceScale: 1_000,
};

interface CryptoCache {
  readonly fetchedAt: number;
  readonly items: readonly SearchInstrument[];
}

function defaultHttp(): SafeExternalTextHttpInputPort {
  return createSafeExternalTextHttpApplication({
    policy: {
      providers: [
        {
          provider: "upbit",
          allowedHosts: ["api.upbit.com"],
          allowedPorts: [443],
          maxRedirectHops: 2,
        },
      ],
      timeoutMs: 10_000,
      maxAttempts: 1,
      maxResponseBytes: 2 * 1024 * 1024,
    },
    transport: new NodeExternalTextHttpTransport(),
  });
}

function lowerInstrumentType(
  value: SearchInstrument["instrumentType"],
): "stock" | "etf" | "etn" | "crypto" {
  switch (value) {
    case "ETF":
      return "etf";
    case "ETN":
      return "etn";
    case "CRYPTO":
      return "crypto";
    default:
      return "stock";
  }
}

function queryView(item: SearchInstrument) {
  if (item.market === "UPBIT_BTC") {
    throw new Error("UNSUPPORTED_QUERY_MARKET");
  }
  const isNationalGrowthFund = item.code === NATIONAL_GROWTH_FUND.code;
  const market = isNationalGrowthFund
    ? "KOFIA_FUND" as const
    : item.market;
  return {
    market,
    instrumentType: isNationalGrowthFund
      ? "fund" as const
      : lowerInstrumentType(item.instrumentType),
    code:
      item.market === "US" && !item.code.startsWith("US:")
        ? `US:${item.code}`
        : item.code,
    name: item.name,
    ...(item.priceScale === undefined ? {} : { priceScale: item.priceScale }),
  };
}

function searchResult(
  result: InstrumentSearchResult,
  input: {
    readonly stale: boolean;
    readonly catalogAsOf?: string;
    readonly catalogVersion?: string;
  },
) {
  const metadata = {
    stale: input.stale,
    ...(input.catalogAsOf === undefined
      ? {}
      : { catalogAsOf: input.catalogAsOf }),
    ...(input.catalogVersion === undefined
      ? {}
      : { catalogVersion: input.catalogVersion }),
  };
  if (result.kind === "success") {
    return {
      kind: "success" as const,
      items: result.items.map(queryView),
      truncated: result.truncated,
      ...metadata,
    };
  }
  return {
    kind: "success" as const,
    items: [],
    truncated: false,
    ...metadata,
  };
}

function stockReader(items: readonly SearchInstrument[]): InstrumentCatalogReader {
  return {
    domestic: () => [
      ...items.filter(({ market }) => market === "KRX"),
      NATIONAL_GROWTH_FUND,
    ],
    us: () => items.filter(({ market }) => market === "US"),
    crypto: () => [],
  };
}

function cryptoReader(items: readonly SearchInstrument[]): InstrumentCatalogReader {
  return {
    domestic: () => [],
    us: () => [],
    crypto: () => items,
  };
}

function parseCryptoCatalog(raw: string): readonly SearchInstrument[] | undefined {
  try {
    const payload = JSON.parse(raw) as unknown;
    if (!Array.isArray(payload)) return undefined;
    const unique = new Map<string, SearchInstrument>();
    for (const value of payload) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return undefined;
      }
      const row = value as Record<string, unknown>;
      if (
        typeof row.market !== "string" ||
        typeof row.korean_name !== "string" ||
        typeof row.english_name !== "string"
      ) {
        return undefined;
      }
      const market = row.market.trim().toLocaleUpperCase("en-US");
      const name = row.korean_name.trim();
      if (!market.startsWith("KRW-") || name === "") continue;
      unique.set(market, {
        market: "UPBIT_KRW",
        instrumentType: "CRYPTO",
        code: market,
        name,
        aliases: [row.english_name.trim()],
      });
    }
    return unique.size === 0 ? undefined : [...unique.values()];
  } catch {
    return undefined;
  }
}

export class FirebasePortfolioInstrumentSearch {
  private cryptoCache?: CryptoCache;

  constructor(
    private readonly catalog: InstrumentCatalog,
    private readonly http: SafeExternalTextHttpInputPort = defaultHttp(),
  ) {}

  async search(input: {
    readonly assetClass: "stock" | "crypto";
    readonly query: string;
    readonly limit: number;
    readonly now: string;
  }) {
    if (input.assetClass === "stock") {
      const catalog = await this.catalog.read({ now: input.now });
      if (catalog.kind === "retryable-failure") {
        return {
          kind: "failure" as const,
          code: catalog.code,
          retryable: true,
        };
      }
      const search = createInstrumentSearchApplication(
        stockReader(catalog.snapshot.items),
      ).searchStocks(input.query, input.limit);
      return searchResult(search, {
        stale: catalog.stale,
        catalogAsOf: catalog.snapshot.asOfDate,
        catalogVersion: catalog.snapshot.catalogVersion,
      });
    }

    const now = Date.parse(input.now);
    let items: readonly SearchInstrument[] | undefined;
    let stale = false;
    if (
      this.cryptoCache !== undefined &&
      Number.isFinite(now) &&
      now - this.cryptoCache.fetchedAt < CRYPTO_CACHE_MILLISECONDS
    ) {
      items = this.cryptoCache.items;
    } else {
      const response = await this.http.execute({
        provider: "upbit",
        operation: "instrument-catalog",
        url: UPBIT_MARKETS_URL,
        headers: { Accept: "application/json" },
      });
      if (response.kind === "success") {
        items = parseCryptoCatalog(response.body);
        if (items === undefined) {
          if (this.cryptoCache === undefined) {
            return {
              kind: "failure" as const,
              code: "CATALOG_SCHEMA_CHANGED",
              retryable: false,
            };
          }
          items = this.cryptoCache.items;
          stale = true;
        } else {
          this.cryptoCache = { fetchedAt: now, items };
        }
      } else if (this.cryptoCache !== undefined) {
        items = this.cryptoCache.items;
        stale = true;
      } else {
        return {
          kind: "failure" as const,
          code: response.code,
          retryable: response.kind === "retryable-failure",
        };
      }
    }
    const search = createInstrumentSearchApplication(
      cryptoReader(items ?? []),
    ).searchCrypto(input.query, input.limit);
    return searchResult(search, { stale });
  }
}
