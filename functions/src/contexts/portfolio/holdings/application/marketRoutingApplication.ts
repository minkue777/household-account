import {
  dividendDisclosureProvidersFor,
  quoteProvidersFor,
} from "../domain/policies/marketRoutingPolicy";
import type { MarketRouting } from "./ports/in/marketRouting";
import type { NormalizedQuoteSource } from "./ports/out/normalizedQuoteSource";

export function createMarketRoutingApplication(
  quoteSource: NormalizedQuoteSource,
): MarketRouting {
  return {
    getQuote(instrument) {
      const selectedProviders = quoteProvidersFor(instrument);
      const provider = selectedProviders[0];
      return {
        kind: "success",
        instrument,
        selectedProviders,
        normalizedQuote:
          provider === undefined
            ? undefined
            : quoteSource.get({ instrument, provider }),
      };
    },
    getDividendDisclosures(instrument) {
      return {
        kind: "success",
        instrument,
        selectedProviders: dividendDisclosureProvidersFor(instrument),
        normalizedQuote: undefined,
      };
    },
  };
}
