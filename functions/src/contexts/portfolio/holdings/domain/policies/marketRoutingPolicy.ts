import type { MarketInstrumentRef } from "../model/marketRouting";

const KRX_GOLD_SPOT_CODES = new Set(["KRXGOLD1KG", "KRXGOLD100G"]);

export function isKrxGoldSpotCode(code: string): boolean {
  return KRX_GOLD_SPOT_CODES.has(code.trim().toLocaleUpperCase("en-US"));
}

export function quoteProvidersFor(
  instrument: MarketInstrumentRef,
): readonly string[] {
  switch (instrument.market) {
    case "KRX":
      return isKrxGoldSpotCode(instrument.code)
        ? ["naver-krx-gold-market"]
        : ["naver-domestic"];
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
