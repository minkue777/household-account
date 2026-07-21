import type {
  MarketInstrumentRef,
  NormalizedMarketQuote,
} from "../../../domain/model/marketRouting";

export interface NormalizedQuoteSource {
  get(input: {
    instrument: MarketInstrumentRef;
    provider: string;
  }): NormalizedMarketQuote;
}
