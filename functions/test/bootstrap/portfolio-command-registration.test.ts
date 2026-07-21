import type * as firestore from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { createPortfolioHouseholdCommandHandlers } from "../../src/bootstrap/commands/portfolioHouseholdCommandHandlers";
import type { PortfolioMarketQuotePort } from "../../src/contexts/portfolio/core/application/ports/out/portfolioRuntimeStorePort";

describe("Portfolio household command registration", () => {
  it("registers every public portfolio command with an executable handler", () => {
    const marketQuotes: PortfolioMarketQuotePort = {
      async getQuote() {
        return {
          kind: "failure",
          code: "NOT_USED",
          retryable: false,
        };
      },
    };
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
});
