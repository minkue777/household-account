import { describe, expect, it } from "vitest";
import { createMarketRoutingContractFixture } from "../../support/market-routing-contract-fixture";

interface InstrumentRef {
  market: "KRX" | "US" | "KOFIA_FUND" | "UPBIT_KRW" | "PHYSICAL_GOLD";
  exchange?: "KOSPI" | "KOSDAQ" | "NASDAQ" | "NYSE" | "AMEX";
  instrumentType: "STOCK" | "ETF" | "FUND" | "CRYPTO" | "PHYSICAL_GOLD";
  code: string;
  currency: "KRW" | "USD";
}

interface RouteResult {
  kind: "success";
  instrument: InstrumentRef;
  selectedProviders: readonly string[];
  normalizedQuote?: {
    sourcePrice: number;
    sourceCurrency: "KRW" | "USD";
    provider: string;
  };
}

export interface MarketRoutingContractSubject {
  getQuote(instrument: InstrumentRef): RouteResult;
  getDividendDisclosures(instrument: InstrumentRef): RouteResult;
}

export function createSubject(): MarketRoutingContractSubject {
  return createMarketRoutingContractFixture();
}

describe("시장별 Provider ACL routing 계약", () => {
  it.each([
    [
      {
        market: "KRX",
        exchange: "KOSPI",
        instrumentType: "STOCK",
        code: "SAME",
        currency: "KRW",
      },
      ["naver-domestic"],
    ],
    [
      {
        market: "KRX",
        instrumentType: "STOCK",
        code: "KRXGOLD1KG",
        currency: "KRW",
      },
      ["naver-krx-gold-market"],
    ],
    [
      {
        market: "US",
        exchange: "NASDAQ",
        instrumentType: "STOCK",
        code: "SAME",
        currency: "USD",
      },
      ["nasdaq-us", "frankfurter-v2"],
    ],
    [
      {
        market: "US",
        exchange: "NYSE",
        instrumentType: "STOCK",
        code: "IBM",
        currency: "USD",
      },
      ["nasdaq-us", "frankfurter-v2"],
    ],
    [
      {
        market: "US",
        exchange: "AMEX",
        instrumentType: "ETF",
        code: "SPY",
        currency: "USD",
      },
      ["nasdaq-us", "frankfurter-v2"],
    ],
    [
      {
        market: "UPBIT_KRW",
        instrumentType: "CRYPTO",
        code: "KRW-BTC",
        currency: "KRW",
      },
      ["upbit"],
    ],
    [
      {
        market: "KOFIA_FUND",
        instrumentType: "FUND",
        code: "EW001",
        currency: "KRW",
      },
      ["miraeasset-fund-nav"],
    ],
    [
      {
        market: "PHYSICAL_GOLD",
        instrumentType: "PHYSICAL_GOLD",
        code: "KR-GOLD-DON",
        currency: "KRW",
      },
      ["physical-gold"],
    ],
  ] as const)(
    "[T-MARKET-004][MARKET-001/MARKET-002] market·exchange가 선택한 Provider만 사용하고 code 형태로 시장을 추정하지 않는다",
    (instrument, selectedProviders) => {
      const result = createSubject().getQuote(instrument);

      expect(result).toEqual({
        kind: "success",
        instrument,
        selectedProviders,
        normalizedQuote: expect.objectContaining({
          sourceCurrency: instrument.currency,
          provider: selectedProviders[0],
        }),
      });
      expect(Object.keys(result.normalizedQuote ?? {})).not.toContain("rawPayload");
    },
  );

  it("[T-MARKET-004][MARKET-001] KRX ETF 배당 공시는 Quote Provider와 분리된 KIND disclosure Adapter로 라우팅한다", () => {
    const instrument: InstrumentRef = {
      market: "KRX",
      exchange: "KOSPI",
      instrumentType: "ETF",
      code: "069500",
      currency: "KRW",
    };

    expect(createSubject().getDividendDisclosures(instrument)).toEqual({
      kind: "success",
      instrument,
      selectedProviders: ["kind-dividend-disclosure"],
      normalizedQuote: undefined,
    });
  });
});
