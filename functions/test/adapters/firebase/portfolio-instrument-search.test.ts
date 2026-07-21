import { describe, expect, it, vi } from "vitest";

import { FirebasePortfolioInstrumentSearch } from "../../../src/adapters/firebase/portfolio/firebasePortfolioInstrumentSearch";
import type { InstrumentCatalog } from "../../../src/contexts/portfolio/holdings/application/ports/in/instrumentCatalog";
import type { SafeExternalTextHttpInputPort } from "../../../src/platform/external-operations/application/ports/in/safeExternalTextHttpInputPort";

function catalog(): InstrumentCatalog {
  return {
    async read() {
      return {
        kind: "success",
        snapshot: {
          schemaVersion: 1,
          asOfDate: "2026-07-21",
          catalogVersion: "v1",
          objectPath: "market-catalog/v1/snapshot.json.gz",
          objectGeneration: "generation-1",
          checksum: "checksum-1",
          itemCount: 2,
          items: [
            {
              market: "KRX",
              instrumentType: "STOCK",
              code: "005930",
              name: "삼성전자",
            },
            {
              market: "US",
              instrumentType: "ETF",
              code: "SPY",
              name: "SPDR S&P 500 ETF Trust",
            },
          ],
        },
        manifestGeneration: "generation-1",
        stale: false,
      };
    },
    async publish() {
      throw new Error("not used by query adapter");
    },
    async publicationState() {
      return { successfulSnapshots: [] };
    },
  };
}

describe("FirebasePortfolioInstrumentSearch", () => {
  it("searches the Cloud Storage catalog without calling a live quote provider", async () => {
    const execute = vi.fn();
    const subject = new FirebasePortfolioInstrumentSearch(catalog(), {
      execute,
    } as SafeExternalTextHttpInputPort);

    await expect(
      subject.search({
        assetClass: "stock",
        query: "SPY",
        limit: 10,
        now: "2026-07-21T01:00:00.000Z",
      }),
    ).resolves.toEqual({
      kind: "success",
      items: [
        {
          market: "US",
          instrumentType: "etf",
          code: "US:SPY",
          name: "SPDR S&P 500 ETF Trust",
        },
      ],
      truncated: false,
      stale: false,
      catalogAsOf: "2026-07-21",
      catalogVersion: "v1",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("keeps the supported fund in the same ranked catalog query", async () => {
    const subject = new FirebasePortfolioInstrumentSearch(catalog(), {
      execute: vi.fn(),
    } as SafeExternalTextHttpInputPort);

    await expect(
      subject.search({
        assetClass: "stock",
        query: "EW001",
        limit: 10,
        now: "2026-07-21T01:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      kind: "success",
      items: [
        {
          market: "KOFIA_FUND",
          instrumentType: "fund",
          code: "FUND:K55301EW0012",
          priceScale: 1_000,
        },
      ],
    });
  });

  it("loads only Upbit KRW instruments and reuses the ten-minute catalog cache", async () => {
    const execute = vi.fn(async () => ({
      kind: "success" as const,
      body: JSON.stringify([
        { market: "KRW-BTC", korean_name: "비트코인", english_name: "Bitcoin" },
        { market: "BTC-ETH", korean_name: "이더리움", english_name: "Ethereum" },
      ]),
      finalUrl: "https://api.upbit.com/v1/market/all?isDetails=false",
      responseBytes: 100,
      attempts: 1,
    }));
    const subject = new FirebasePortfolioInstrumentSearch(catalog(), { execute });

    const first = await subject.search({
      assetClass: "crypto",
      query: "Bitcoin",
      limit: 10,
      now: "2026-07-21T01:00:00.000Z",
    });
    const second = await subject.search({
      assetClass: "crypto",
      query: "비트",
      limit: 10,
      now: "2026-07-21T01:05:00.000Z",
    });

    expect(first).toMatchObject({
      kind: "success",
      items: [{ market: "UPBIT_KRW", code: "KRW-BTC", name: "비트코인" }],
    });
    expect(second).toMatchObject({
      kind: "success",
      items: [{ market: "UPBIT_KRW", code: "KRW-BTC", name: "비트코인" }],
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
