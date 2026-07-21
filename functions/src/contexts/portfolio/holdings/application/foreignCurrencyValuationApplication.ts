import type {
  ProviderSelectionEvidence,
  RefreshForeignCurrencyValuationResult,
} from "../domain/model/foreignCurrencyValuation";
import {
  parseFrankfurterRate,
  valueSourceQuoteInWon,
} from "../domain/policies/foreignCurrencyValuationPolicy";
import type { ForeignCurrencyValuation } from "./ports/in/foreignCurrencyValuation";
import type {
  ForeignCurrencyValuationStore,
  FrankfurterExchangeRateProvider,
  SourceQuoteReader,
} from "./ports/out/foreignCurrencyValuationPorts";

const PROVIDER_SELECTION: ProviderSelectionEvidence = {
  selectedProvider: "frankfurter-v2",
  fallbackUsed: false,
};

export function createForeignCurrencyValuationApplication(dependencies: {
  provider: FrankfurterExchangeRateProvider;
  sourceQuoteReader: SourceQuoteReader;
  store: ForeignCurrencyValuationStore;
}): ForeignCurrencyValuation {
  function failure(code: string): RefreshForeignCurrencyValuationResult {
    dependencies.store.recordFailure(code);
    const retainedValue = dependencies.store.currentWonQuote();
    return retainedValue === undefined
      ? {
          kind: "no-data",
          code: "EXCHANGE_RATE_NOT_OBSERVED",
          providerSelection: PROVIDER_SELECTION,
        }
      : {
          kind: "partial-failure",
          code,
          retainedValue,
          providerSelection: PROVIDER_SELECTION,
        };
  }

  return {
    async refreshAndValue(command) {
      const providerResult = await dependencies.provider.fetch();
      if (providerResult.kind === "timeout") {
        return failure("EXCHANGE_RATE_TIMEOUT");
      }
      if (providerResult.kind === "schema-drift") {
        return failure("EXCHANGE_RATE_SCHEMA_CHANGED");
      }
      if (providerResult.status !== 200) {
        return failure(`EXCHANGE_RATE_HTTP_${providerResult.status}`);
      }

      const parsed = parseFrankfurterRate({
        body: providerResult.body,
        observedAt: providerResult.observedAt,
        asOfDate: command.asOfDate,
      });
      if (parsed.kind === "failure") return failure(parsed.code);

      const currentRate = dependencies.store.currentRate();
      if (
        currentRate !== undefined &&
        (parsed.value.rateDate < currentRate.rateDate ||
          (parsed.value.rateDate === currentRate.rateDate &&
            parsed.value.observedAt <= currentRate.observedAt))
      ) {
        return failure("STALE_EXCHANGE_RATE_RESPONSE");
      }

      const sourceQuote = dependencies.sourceQuoteReader.current();
      const value = valueSourceQuoteInWon(sourceQuote, parsed.value);
      dependencies.store.commitSuccess({
        rate: parsed.value,
        wonQuote: value,
        events: [
          {
            eventType: "PositionChanged.v1",
            priceInWon: value.priceInWon,
            quoteObservedAt: value.quoteObservedAt,
            exchangeRateObservedAt: value.exchangeRateObservedAt,
          },
          {
            eventType: "AssetValuationChanged.v1",
            currentSignedBalance: Math.round(value.priceInWon * command.quantity),
          },
        ],
      });
      return {
        kind: "success",
        value,
        providerSelection: PROVIDER_SELECTION,
      };
    },
    currentRate: () => dependencies.store.currentRate(),
    currentWonQuote: () => dependencies.store.currentWonQuote(),
    providerHealth: () => dependencies.store.health(),
    recordedEvents: () => dependencies.store.events(),
  };
}
