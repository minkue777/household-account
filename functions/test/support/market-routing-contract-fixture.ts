import { createMarketRoutingApplication } from "../../src/contexts/portfolio/holdings/application/marketRoutingApplication";
import type { NormalizedQuoteSource } from "../../src/contexts/portfolio/holdings/application/ports/out/normalizedQuoteSource";

export function createMarketRoutingContractFixture() {
  const quoteSource: NormalizedQuoteSource = {
    get: ({ instrument, provider }) => ({
      sourcePrice: 1,
      sourceCurrency: instrument.currency,
      provider,
    }),
  };
  return createMarketRoutingApplication(quoteSource);
}
