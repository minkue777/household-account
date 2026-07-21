import type {
  MarketInstrumentRef,
  MarketRouteResult,
} from "../../../domain/model/marketRouting";

export interface MarketRouting {
  getQuote(instrument: MarketInstrumentRef): MarketRouteResult;
  getDividendDisclosures(instrument: MarketInstrumentRef): MarketRouteResult;
}
