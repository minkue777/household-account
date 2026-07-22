import type * as firestore from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { createPortfolioHouseholdCommandHandlers } from "../../src/bootstrap/commands/portfolioHouseholdCommandHandlers";
import type { PortfolioMarketQuotePort } from "../../src/contexts/portfolio/core/application/ports/out/portfolioRuntimeStorePort";
import { InMemoryFirestore } from "../support/in-memory-firestore";

const marketQuotes: PortfolioMarketQuotePort = {
  async getQuote() {
    return {
      kind: "failure",
      code: "NOT_USED",
      retryable: false,
    };
  },
};

describe("Portfolio household command registration", () => {
  it("registers every public portfolio command with an executable handler", () => {
    const handlers = createPortfolioHouseholdCommandHandlers(
      {} as firestore.Firestore,
      marketQuotes,
    );

    expect([...handlers.keys()]).toEqual([
      "portfolio.create-asset.v1",
      "portfolio.update-asset.v1",
      "portfolio.reorder-assets.v1",
      "portfolio.delete-asset.v1",
      "portfolio.add-position.v1",
      "portfolio.update-position.v1",
      "portfolio.delete-position.v1",
      "portfolio.refresh-market-values.v1",
    ]);
    expect([...handlers.values()].every(({ execute }) => typeof execute === "function")).toBe(
      true,
    );
  });

  it("[T-HOLD-001][HOLD-001] routes a legacy cash amount edit through the authoritative command handler", async () => {
    const memory = new InMemoryFirestore();
    memory.seed("assets/asset-1", {
      householdId: "house-1",
      name: "주식계좌",
      type: "stock",
      owner: "가구",
      currency: "KRW",
      currentBalance: 1_000_000,
      memo: "",
      isActive: true,
      order: 0,
      aggregateVersion: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    memory.seed("stock_holdings/legacy-cash-1", {
      householdId: "house-1",
      assetId: "asset-1",
      holdingType: "cash",
      stockCode: "",
      stockName: "예수금",
      quantity: 1,
      currentPrice: 1_000_000,
      aggregateVersion: 3,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    const handler = createPortfolioHouseholdCommandHandlers(
      memory as unknown as firestore.Firestore,
      marketQuotes,
    ).get("portfolio.update-position.v1");

    await expect(
      handler?.execute({
        envelope: {
          contractVersion: "household-command.v1",
          commandId: "command-legacy-cash-update",
          idempotencyKey: "command-legacy-cash-update",
          householdId: "house-1",
          command: "portfolio.update-position.v1",
          payload: {
            assetId: "asset-1",
            positionId: "legacy-cash-1",
            positionKind: "stock",
            changes: {
              stockName: "예수금",
              quantity: 1,
              currentPrice: 1_500_000,
            },
            expectedVersion: 3,
          },
        },
        principalUid: "uid-1",
        actor: {
          principalUid: "uid-1",
          householdId: "house-1",
          actingMemberId: "member-1",
          capabilities: ["portfolio.asset.write"],
        },
        requestedAt: "2026-07-22T12:00:00.000Z",
      }),
    ).resolves.toEqual({});

    expect(memory.document("stock_holdings/legacy-cash-1")).toMatchObject({
      holdingType: "cash",
      currentPrice: 1_500_000,
      aggregateVersion: 4,
    });
    expect(memory.document("assets/asset-1")).toMatchObject({
      currentBalance: 1_500_000,
      aggregateVersion: 2,
    });
  });
});
