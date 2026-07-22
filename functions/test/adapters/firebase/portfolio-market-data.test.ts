import { afterEach, describe, expect, it, vi } from "vitest";

import { FirebasePortfolioMarketData } from "../../../src/adapters/firebase/portfolio/firebasePortfolioMarketData";
import type { PortfolioMarketTarget } from "../../../src/contexts/portfolio/core/application/ports/out/portfolioRuntimeStorePort";

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
});

describe("Firebase portfolio market-data adapter", () => {
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
