import type {
  ExchangeRateObservation,
  ForeignCurrencyValuationEvent,
  ProviderHealthView,
  RefreshForeignCurrencyValuationCommand,
  RefreshForeignCurrencyValuationResult,
  WonValuationQuote,
} from "../../../domain/model/foreignCurrencyValuation";

export interface ForeignCurrencyValuation {
  refreshAndValue(
    command: RefreshForeignCurrencyValuationCommand,
  ): Promise<RefreshForeignCurrencyValuationResult>;
  currentRate(): ExchangeRateObservation | undefined;
  currentWonQuote(): WonValuationQuote | undefined;
  providerHealth(): ProviderHealthView;
  recordedEvents(): readonly ForeignCurrencyValuationEvent[];
}
