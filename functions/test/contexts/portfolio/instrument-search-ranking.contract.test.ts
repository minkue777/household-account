import { describe, expect, it } from "vitest";
import { createInstrumentSearchRankingFixture } from "../../support/instrument-search-ranking-fixture";

interface SearchInstrument {
  market: "KRX" | "US" | "UPBIT_KRW" | "UPBIT_BTC";
  instrumentType: "STOCK" | "ETF" | "ETN" | "CRYPTO";
  code: string;
  name: string;
}

type SearchResult =
  | {
      kind: "success";
      items: readonly SearchInstrument[];
      truncated: boolean;
    }
  | { kind: "validation-error"; code: "SEARCH_QUERY_REQUIRED" }
  | { kind: "no-data" };

export interface InstrumentSearchRankingSubject {
  searchStocks(query: string, limit?: number): SearchResult;
  searchCrypto(query: string, limit?: number): SearchResult;
}

export function createSubject(seed: {
  domestic: readonly SearchInstrument[];
  us: readonly SearchInstrument[];
  crypto: readonly SearchInstrument[];
}): InstrumentSearchRankingSubject {
  return createInstrumentSearchRankingFixture(seed);
}

const stock = (
  index: number,
  overrides: Partial<SearchInstrument> = {},
): SearchInstrument => ({
  market: "KRX",
  instrumentType: "STOCK",
  code: `A${String(index).padStart(3, "0")}`,
  name: `Alpha ${String(index).padStart(2, "0")}`,
  ...overrides,
});

describe("종목 검색 관련도·시장 filter 계약", () => {
  it("[T-MARKET-005][MARKET-003] 국내·미국 결과를 결정적 관련도순 최대 10개로 합치고 exact code를 우선한다", () => {
    const domestic = Array.from({ length: 7 }, (_, index) => stock(index + 1));
    const us = Array.from({ length: 6 }, (_, index) =>
      stock(index + 8, { market: "US" }),
    );
    const exact = stock(99, {
      market: "US",
      code: "ALPHA",
      name: "Exact code company",
    });
    const subject = createSubject({
      domestic,
      us: [exact, ...us, exact],
      crypto: [],
    });

    const result = subject.searchStocks("alpha", 10);

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("검색 성공 계약을 기대했습니다.");
    }
    expect(result.items).toHaveLength(10);
    expect(result.items[0]).toEqual(exact);
    expect(result.items.filter(({ market, code }) => market === "US" && code === "ALPHA")).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });

  it("[T-MARKET-005][MARKET-003] exact code→code prefix→name prefix→name contains와 market·code tie-break를 결정적으로 적용한다", () => {
    const exact = stock(1, {
      market: "US",
      code: "ALPHA",
      name: "Exact company",
    });
    const codePrefixKrx = stock(2, {
      market: "KRX",
      instrumentType: "ETN",
      code: "ALPHA1",
      name: "코드 접두 ETN",
    });
    const codePrefixUs = stock(3, {
      market: "US",
      code: "ALPHA2",
      name: "Code prefix stock",
    });
    const namePrefix = stock(4, {
      market: "KRX",
      code: "B001",
      name: "Alpha Fund",
      instrumentType: "ETF",
    });
    const nameContains = stock(5, {
      market: "US",
      code: "C001",
      name: "Global Alpha Holdings",
    });
    const subject = createSubject({
      domestic: [namePrefix, codePrefixKrx],
      us: [nameContains, codePrefixUs, exact],
      crypto: [],
    });

    expect(subject.searchStocks("alpha", 10)).toEqual({
      kind: "success",
      items: [exact, codePrefixKrx, codePrefixUs, namePrefix, nameContains],
      truncated: false,
    });
  });

  it("[T-MARKET-005][MARKET-003] 코인 검색은 Upbit KRW market만 최대 10개 반환한다", () => {
    const subject = createSubject({
      domestic: [],
      us: [],
      crypto: [
        {
          market: "UPBIT_KRW",
          instrumentType: "CRYPTO",
          code: "KRW-BTC",
          name: "비트코인",
        },
        {
          market: "UPBIT_BTC",
          instrumentType: "CRYPTO",
          code: "BTC-ETH",
          name: "이더리움",
        },
      ],
    });

    expect(subject.searchCrypto("코인", 10)).toEqual({
      kind: "success",
      items: [
        {
          market: "UPBIT_KRW",
          instrumentType: "CRYPTO",
          code: "KRW-BTC",
          name: "비트코인",
        },
      ],
      truncated: false,
    });
  });

  it.each(["", "   "])(
    "[T-MARKET-005][MARKET-003] 빈 검색어 %#는 전체 catalog 조회로 바꾸지 않고 typed error다",
    (query) => {
      const subject = createSubject({ domestic: [], us: [], crypto: [] });

      expect(subject.searchStocks(query)).toEqual({
        kind: "validation-error",
        code: "SEARCH_QUERY_REQUIRED",
      });
      expect(subject.searchCrypto(query)).toEqual({
        kind: "validation-error",
        code: "SEARCH_QUERY_REQUIRED",
      });
    },
  );
});
