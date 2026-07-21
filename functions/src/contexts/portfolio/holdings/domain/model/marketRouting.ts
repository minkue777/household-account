export interface MarketInstrumentRef {
  market: "KRX" | "US" | "KOFIA_FUND" | "UPBIT_KRW" | "PHYSICAL_GOLD";
  exchange?: "KOSPI" | "KOSDAQ" | "NASDAQ" | "NYSE" | "AMEX";
  instrumentType: "STOCK" | "ETF" | "FUND" | "CRYPTO" | "PHYSICAL_GOLD";
  code: string;
  currency: "KRW" | "USD";
}

export interface NormalizedMarketQuote {
  sourcePrice: number;
  sourceCurrency: "KRW" | "USD";
  provider: string;
}

export interface MarketRouteResult {
  kind: "success";
  instrument: MarketInstrumentRef;
  selectedProviders: readonly string[];
  normalizedQuote?: NormalizedMarketQuote;
}
