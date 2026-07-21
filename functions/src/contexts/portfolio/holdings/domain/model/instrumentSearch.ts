export type InstrumentMarket = "KRX" | "US" | "UPBIT_KRW" | "UPBIT_BTC";

export type InstrumentType = "STOCK" | "ETF" | "ETN" | "CRYPTO";

export interface SearchInstrument {
  market: InstrumentMarket;
  instrumentType: InstrumentType;
  code: string;
  name: string;
  aliases?: readonly string[];
  priceScale?: number;
}

export type CatalogInstrument = SearchInstrument & {
  market: "KRX" | "US";
  instrumentType: "STOCK" | "ETF" | "ETN";
};

export type InstrumentSearchResult =
  | {
      kind: "success";
      items: readonly SearchInstrument[];
      truncated: boolean;
    }
  | { kind: "validation-error"; code: "SEARCH_QUERY_REQUIRED" }
  | { kind: "no-data" };
