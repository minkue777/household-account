export interface SourceQuoteObservation {
  sourcePrice: number;
  sourcePreviousClose: number;
  sourceCurrency: "USD";
  observedAt: string;
  provider: string;
}

export interface ExchangeRateObservation {
  pair: "USD/KRW";
  rate: number;
  rateDate: string;
  observedAt: string;
  provider: "frankfurter-v2";
}

export interface WonValuationQuote {
  priceInWon: number;
  previousCloseInWon: number;
  quoteObservedAt: string;
  quoteProvider: string;
  exchangeRateDate: string;
  exchangeRateObservedAt: string;
  exchangeRateProvider: "frankfurter-v2";
}

export interface ProviderSelectionEvidence {
  selectedProvider: "frankfurter-v2";
  fallbackUsed: false;
}

export type RefreshForeignCurrencyValuationResult =
  | {
      kind: "success";
      value: WonValuationQuote;
      providerSelection: ProviderSelectionEvidence;
    }
  | {
      kind: "partial-failure";
      code: string;
      retainedValue: WonValuationQuote;
      providerSelection: ProviderSelectionEvidence;
    }
  | {
      kind: "no-data";
      code: "EXCHANGE_RATE_NOT_OBSERVED";
      providerSelection: ProviderSelectionEvidence;
    };

export interface ProviderHealthView {
  provider: "frankfurter-v2";
  operation: "USD_KRW_RATE";
  status: "healthy" | "degraded" | "outage";
  consecutiveFailedRuns: number;
  alertState: "closed" | "open";
  lastErrorCode?: string;
}

export type ForeignCurrencyValuationEvent =
  | {
      eventType: "PositionChanged.v1";
      priceInWon: number;
      quoteObservedAt: string;
      exchangeRateObservedAt: string;
    }
  | {
      eventType: "AssetValuationChanged.v1";
      currentSignedBalance: number;
    };

export interface RefreshForeignCurrencyValuationCommand {
  householdId: string;
  assetId: string;
  quantity: number;
  asOfDate: string;
}
