import { afterEach, describe, expect, it, vi } from "vitest";

import { FirebasePortfolioMarketData } from "../../../src/adapters/firebase/portfolio/firebasePortfolioMarketData";
import type { PortfolioMarketTarget } from "../../../src/contexts/portfolio/core/application/ports/out/portfolioRuntimeStorePort";
import { calculateAccountValuationPolicy } from "../../../src/contexts/portfolio/holdings/domain/policies/accountValuation";
import { FirebasePortfolioQuoteObservations } from "../../../src/adapters/firebase/portfolio/firebasePortfolioQuoteObservations";
import { InMemoryFirestore } from "../../support/in-memory-firestore";
import type { Firestore } from "firebase-admin/firestore";

function target(
  market: PortfolioMarketTarget["market"],
  instrumentCode: string,
): PortfolioMarketTarget {
  return {
    targetKey: `${market}:${instrumentCode}`,
    assetId: "asset-1",
    kind:
      market === "UPBIT_KRW"
        ? "crypto"
        : market === "PHYSICAL_GOLD"
          ? "physical-gold"
          : "stock",
    market,
    instrumentCode,
    quantity: 1,
    priceScale: market === "KOFIA_FUND" ? 1_000 : 1,
  };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Firebase portfolio market-data adapter", () => {
  it("keeps the newer FX date, rejects future FX, and revalues the retained USD quote on FX-only success", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T00:00:00Z"));
    const observations = new FirebasePortfolioQuoteObservations(new InMemoryFirestore() as unknown as Firestore);
    let rateDate = "2026-09-05";
    let rate = 1400;
    let quoteAvailable = true;
    vi.stubGlobal("fetch", vi.fn(async input => String(input).includes("frankfurter")
      ? json({ base: "USD", quote: "KRW", rate, date: rateDate })
      : quoteAvailable ? json({ data: { primaryData: { lastSalePrice: "$100" } } }) : new Response("unavailable", { status: 503 })));
    await new FirebasePortfolioMarketData(undefined, observations).getQuote(target("US", "US:AAPL"));
    rateDate = "2026-09-04"; rate = 1300;
    await expect(new FirebasePortfolioMarketData(undefined, observations).getQuote(target("US", "US:AAPL"))).resolves.toMatchObject({ kind: "success", quote: { priceInWon: 140000, exchangeRateDate: "2026-09-05" } });
    rateDate = "2026-09-07"; rate = 1500;
    await expect(new FirebasePortfolioMarketData(undefined, observations).getQuote(target("US", "US:AAPL"))).resolves.toMatchObject({ kind: "success", quote: { priceInWon: 140000 }, providerFailures: [expect.objectContaining({ provider: "frankfurter-v2" })] });
    quoteAvailable = false; rateDate = "2026-09-06"; rate = 1450;
    await expect(new FirebasePortfolioMarketData(undefined, observations).getQuote(target("US", "US:AAPL"))).resolves.toMatchObject({ kind: "success", quote: { priceInWon: 145000, exchangeRateDate: "2026-09-06" }, providerFailures: [expect.objectContaining({ provider: "nasdaq-us" })] });
    await expect(observations.rate()).resolves.toMatchObject({ rateDate: "2026-09-06", rate: 1450 });
  });
  it("reuses durable FX across process restarts and independently values the latest USD quote", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:00Z"));
    const observations = new FirebasePortfolioQuoteObservations(new InMemoryFirestore() as unknown as Firestore);
    let price = 0.03;
    let rateAvailable = true;
    vi.stubGlobal("fetch", vi.fn(async input => String(input).includes("frankfurter")
      ? rateAvailable ? json({ base: "USD", quote: "KRW", rate: 1400, date: "2026-09-01" }) : new Response("unavailable", { status: 503 })
      : json({ data: { primaryData: { lastSalePrice: `$${price}` } } })));
    await expect(new FirebasePortfolioMarketData(undefined, observations).getQuote(target("US", "US:AAPL"))).resolves.toMatchObject({ kind: "success", quote: { priceInWon: 42, exchangeRateDate: "2026-09-01" } });
    vi.setSystemTime(new Date("2026-09-06T00:00:00Z"));
    rateAvailable = false;
    price = 0.07;
    await expect(new FirebasePortfolioMarketData(undefined, observations).getQuote(target("US", "US:AAPL"))).resolves.toMatchObject({ kind: "success", quote: { priceInWon: 98.00000000000001, sourcePrice: 0.07, quoteObservedAt: "2026-09-06T00:00:00.000Z", exchangeRateObservedAt: "2026-09-01T00:00:00.000Z" }, providerFailures: [expect.objectContaining({ provider: "frankfurter-v2" })] });
  });

  it("selects the latest valid published fund NAV at or before Seoul today", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T16:00:00Z"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<table><tr><td>2026.09.07</td><td>9999</td></tr><tr><td>2026.09.06</td><td>1001.19</td></tr><tr><td>2026.02.30</td><td>8888</td></tr></table>")));
    await expect(new FirebasePortfolioMarketData().getQuote(target("KOFIA_FUND", "EW001"))).resolves.toMatchObject({ kind: "success", quote: { priceInWon: 1001.19 }, quoteAsOf: "2026-09-06" });
  });

  it("preserves fractional unit quotes until the account valuation rounds the total", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json([{ trade_price: 0.03 }])));
    const quote = await new FirebasePortfolioMarketData().getQuote(target("UPBIT_KRW", "KRW-SMALL"));
    expect(quote.kind).toBe("success");
    if (quote.kind !== "success") throw new Error("quote failed");
    expect(quote.quote.priceInWon).toBe(0.03);
    expect(calculateAccountValuationPolicy([{ positionId: "coin", kind: "crypto", quantity: 100000, averagePrice: 0.02, currentPrice: quote.quote.priceInWon, priceScale: 1 }]).currentBalance).toBe(3000);
  });

  it("routes each explicit market to its provider and normalizes every quote to KRW", async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        requested.push(url);
        if (url.includes("/api/stock/005930/basic")) {
          return json({ closePrice: "70,000" });
        }
        if (url.includes("api.nasdaq.com") && url.includes("AAPL")) {
          return json({ data: { primaryData: { lastSalePrice: "$100.25" } } });
        }
        if (url.includes("frankfurter.dev")) {
          return json({ date: "2026-07-20", base: "USD", quote: "KRW", rate: 1_400 });
        }
        if (url.includes("api.upbit.com")) {
          return json([{ trade_price: 50_000, timestamp: 1_774_281_600_000 }]);
        }
        if (url.includes("basePrices.do")) {
          return new Response(
            "<table><tr><td>2026.07.20</td><td>1,001.19</td></tr></table>",
            { status: 200 },
          );
        }
        if (url.includes("marketindex/metals")) {
          const nextData = {
            props: {
              pageProps: {
                dehydratedState: {
                  queries: [{ state: { data: { result: { closePrice: "100,000" } } } }],
                },
              },
            },
          };
          return new Response(
            `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script>`,
            { status: 200 },
          );
        }
        return new Response("not found", { status: 404 });
      }),
    );
    const adapter = new FirebasePortfolioMarketData();

    await expect(adapter.getQuote(target("KRX", "005930"))).resolves.toMatchObject({
      kind: "success",
      quote: { priceInWon: 70_000, provider: "naver-domestic" },
    });
    await expect(
      adapter.getQuote(target("KRX", "KRXGOLD1KG")),
    ).resolves.toMatchObject({
      kind: "success",
      quote: { priceInWon: 100_000, provider: "naver-krx-gold-market" },
    });
    await expect(adapter.getQuote(target("US", "US:AAPL"))).resolves.toMatchObject({
      kind: "success",
      quote: {
        priceInWon: 140_350,
        provider: "nasdaq-us+frankfurter-v2",
      },
      quoteAsOf: "2026-07-20",
    });
    await expect(
      adapter.getQuote(target("UPBIT_KRW", "KRW-BTC")),
    ).resolves.toMatchObject({
      kind: "success",
      quote: { priceInWon: 50_000, provider: "upbit" },
    });
    await expect(adapter.getQuote(target("KOFIA_FUND", "EW001"))).resolves.toMatchObject({
      kind: "success",
      quote: { priceInWon: 1_001.19, provider: "miraeasset-fund-nav" },
      quoteAsOf: "2026-07-20",
    });
    await expect(
      adapter.getQuote(target("PHYSICAL_GOLD", "KR-GOLD-DON")),
    ).resolves.toMatchObject({
      kind: "success",
      quote: { priceInWon: 375_000, provider: "naver-krx-gold-market" },
    });

    expect(requested.some((url) => url.includes("/api/stock/005930/basic"))).toBe(true);
    expect(
      requested.some((url) => url.includes("/api/stock/KRXGOLD1KG/basic")),
    ).toBe(false);
    expect(requested.some((url) => url.includes("api.nasdaq.com"))).toBe(true);
    expect(requested.some((url) => url.includes("frankfurter.dev"))).toBe(true);
    expect(requested.some((url) => url.includes("api.upbit.com"))).toBe(true);
    expect(requested.some((url) => url.includes("basePrices.do"))).toBe(true);
    expect(requested.some((url) => url.includes("marketindex/metals"))).toBe(true);
  });

  it("returns a typed failure instead of a fabricated fixed price", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new FirebasePortfolioMarketData();

    await expect(
      adapter.getQuote(target("KOFIA_FUND", "UNKNOWN-FUND")),
    ).resolves.toEqual({
      kind: "failure",
      code: "INSTRUMENT_NOT_FOUND",
      retryable: false,
      provider: "miraeasset-fund-nav",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
