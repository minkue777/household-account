import type {
  ExchangeRateObservation,
  ForeignCurrencyValuationEvent,
  ProviderHealthView,
  SourceQuoteObservation,
  WonValuationQuote,
} from "../../../domain/model/foreignCurrencyValuation";

export type RawExchangeRateProviderResult =
  | {
      kind: "response";
      status: number;
      body: unknown;
      observedAt: string;
    }
  | { kind: "timeout" }
  | { kind: "schema-drift" };

export interface FrankfurterExchangeRateProvider {
  fetch(): Promise<RawExchangeRateProviderResult>;
}

export interface SourceQuoteReader {
  current(): SourceQuoteObservation;
}

export interface ForeignCurrencyValuationStore {
  currentRate(): ExchangeRateObservation | undefined;
  currentWonQuote(): WonValuationQuote | undefined;
  health(): ProviderHealthView;
  events(): readonly ForeignCurrencyValuationEvent[];
  recordFailure(code: string): void;
  commitSuccess(input: {
    rate: ExchangeRateObservation;
    wonQuote: WonValuationQuote;
    events: readonly ForeignCurrencyValuationEvent[];
  }): void;
}
