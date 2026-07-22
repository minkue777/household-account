import { describe, expect, it } from "vitest";

import { providerObservations } from "../../../src/contexts/portfolio/core/application/portfolioMarketRefreshPolicy";
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
