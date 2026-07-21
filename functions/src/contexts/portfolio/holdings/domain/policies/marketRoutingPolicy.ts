import type { MarketInstrumentRef } from "../model/marketRouting";

export function quoteProvidersFor(
  instrument: MarketInstrumentRef,
): readonly string[] {
  switch (instrument.market) {
    case "KRX":
      return ["naver-domestic"];
    case "US":
      return ["nasdaq-us", "frankfurter-v2"];
    case "UPBIT_KRW":
      return ["upbit"];
    case "KOFIA_FUND":
      return ["miraeasset-fund-nav"];
    case "PHYSICAL_GOLD":
      return ["physical-gold"];
  }
}

export function dividendDisclosureProvidersFor(
  instrument: MarketInstrumentRef,
): readonly string[] {
  return instrument.market === "KRX" && instrument.instrumentType === "ETF"
    ? ["kind-dividend-disclosure"]
    : [];
}
