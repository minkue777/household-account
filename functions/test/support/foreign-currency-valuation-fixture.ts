import { createForeignCurrencyValuationApplication } from "../../src/contexts/portfolio/holdings/application/foreignCurrencyValuationApplication";
import type {
  ForeignCurrencyValuationStore,
  FrankfurterExchangeRateProvider,
  RawExchangeRateProviderResult,
  SourceQuoteReader,
} from "../../src/contexts/portfolio/holdings/application/ports/out/foreignCurrencyValuationPorts";
import type {
  ExchangeRateObservation,
  ForeignCurrencyValuationEvent,
  ProviderHealthView,
  SourceQuoteObservation,
  WonValuationQuote,
} from "../../src/contexts/portfolio/holdings/public";

export function createForeignCurrencyValuationFixture(seed: {
  sourceQuote: SourceQuoteObservation;
  storedRate?: ExchangeRateObservation;
  storedWonQuote?: WonValuationQuote;
  providerResults: readonly RawExchangeRateProviderResult[];
}) {
  let rate = seed.storedRate === undefined ? undefined : { ...seed.storedRate };
  let wonQuote =
    seed.storedWonQuote === undefined ? undefined : { ...seed.storedWonQuote };
  let health: ProviderHealthView = {
    provider: "frankfurter-v2",
    operation: "USD_KRW_RATE",
    status: "healthy",
    consecutiveFailedRuns: 0,
    alertState: "closed",
  };
  const events: ForeignCurrencyValuationEvent[] = [];
  const results = [...seed.providerResults];

  const provider: FrankfurterExchangeRateProvider = {
    fetch: async () =>
      results.shift() ?? { kind: "timeout" },
  };
  const sourceQuoteReader: SourceQuoteReader = {
    current: () => ({ ...seed.sourceQuote }),
  };
  const store: ForeignCurrencyValuationStore = {
    currentRate: () => (rate === undefined ? undefined : { ...rate }),
    currentWonQuote: () =>
      wonQuote === undefined ? undefined : { ...wonQuote },
    health: () => ({ ...health }),
    events: () => events.map((event) => ({ ...event })),
    recordFailure: (code) => {
      const consecutiveFailedRuns = health.consecutiveFailedRuns + 1;
      health = {
        provider: "frankfurter-v2",
        operation: "USD_KRW_RATE",
        status: consecutiveFailedRuns >= 3 ? "outage" : "degraded",
        consecutiveFailedRuns,
        alertState: consecutiveFailedRuns >= 3 ? "open" : "closed",
        lastErrorCode: code,
      };
    },
    commitSuccess: (input) => {
      rate = { ...input.rate };
      wonQuote = { ...input.wonQuote };
      events.push(...input.events.map((event) => ({ ...event })));
      health = {
        provider: "frankfurter-v2",
        operation: "USD_KRW_RATE",
        status: "healthy",
        consecutiveFailedRuns: 0,
        alertState: "closed",
      };
    },
  };
  return createForeignCurrencyValuationApplication({
    provider,
    sourceQuoteReader,
    store,
  });
}
