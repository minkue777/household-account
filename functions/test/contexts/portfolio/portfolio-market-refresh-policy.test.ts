import { describe, expect, it } from "vitest";

import { providerObservations, quoteWithRetries } from "../../../src/contexts/portfolio/core/application/portfolioMarketRefreshPolicy";
import type {
  PortfolioCommandMetadata,
  PortfolioMarketTarget,
} from "../../../src/contexts/portfolio/core/application/ports/out/portfolioRuntimeStorePort";

const metadata: PortfolioCommandMetadata = {
  householdId: "household-1",
  principalUid: "system",
  actorMemberId: "system",
  commandId: "command-1",
  idempotencyKey: "valuation-2026-07-23",
  commandName: "RefreshPortfolioMarketData",
  payloadFingerprint: "fingerprint",
  occurredAt: "2026-07-23T14:55:00.000Z",
};

const krxGoldTarget: PortfolioMarketTarget = {
  targetKey: "position:gold-1",
  assetId: "asset-1",
  positionId: "gold-1",
  kind: "stock",
  market: "KRX",
  instrumentCode: "KRXGOLD1KG",
  quantity: 171,
  priceScale: 1,
};

describe("portfolio market refresh provider observations", () => {
  it("backs off between retryable quote attempts and never retries contract failures", async () => {
    const delays: number[] = [];
    let calls = 0;
    const result = await quoteWithRetries({ async getQuote() { calls++; return { kind: "failure", code: "TIMEOUT", retryable: true }; } }, krxGoldTarget, { async sleep(delay) { delays.push(delay); }, random: () => 0.5 });
    expect(calls).toBe(3);
    expect(delays).toEqual([250, 500]);
    expect(result.attempts).toHaveLength(3);
    await quoteWithRetries({ async getQuote() { return { kind: "failure", code: "CONTRACT_FAILURE", retryable: false }; } }, krxGoldTarget, { async sleep() { throw new Error("contract failure must not retry"); }, random: () => 0.5 });
  });

  it("attributes a KRX gold spot quote to the Naver gold-market provider", () => {
    const observations = providerObservations({
      metadata,
      scopeKey: "daily-valuation",
      executions: [
        {
          target: krxGoldTarget,
          result: {
            kind: "success",
            quote: {
              priceInWon: 195_830,
              observedAt: "2026-07-23T14:55:00.000Z",
              provider: "naver-krx-gold-market",
            },
          },
          attempts: [
            {
              latencyMs: 25,
              result: {
                kind: "success",
                quote: {
                  priceInWon: 195_830,
                  observedAt: "2026-07-23T14:55:00.000Z",
                  provider: "naver-krx-gold-market",
                },
              },
            },
          ],
        },
      ],
    });

    expect(observations).toEqual([
      expect.objectContaining({
        provider: "naver-krx-gold-market",
        operation: "market-quote",
        finalResult: expect.objectContaining({ kind: "SUCCESS" }),
      }),
    ]);
  });
});
