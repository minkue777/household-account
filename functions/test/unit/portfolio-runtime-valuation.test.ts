import { describe, expect, it } from "vitest";

import { positionEvent } from "../../src/contexts/portfolio/core/application/portfolioRuntimeValuation";
import type { PortfolioRuntimePosition } from "../../src/contexts/portfolio/core/application/ports/out/portfolioRuntimeStorePort";

function cashPosition(): PortfolioRuntimePosition {
  return {
    positionId: "cash-1",
    householdId: "house-1",
    assetId: "asset-1",
    positionKind: "stock",
    instrumentCode: "LEGACY:CASH:CASH-1",
    instrumentName: "예수금",
    instrumentType: "cash",
    market: "UNRESOLVED",
    currency: "KRW",
    holdingType: "cash",
    quantity: 1,
    averagePriceInWon: 1_000_000,
    priceScale: 1,
    aggregateVersion: 3,
    lifecycleState: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
  };
}

describe("portfolio runtime event serialization", () => {
  it("시세가 없는 예수금 삭제 이벤트에는 undefined 필드를 만들지 않는다", () => {
    const event = positionEvent({
      operation: "deleted",
      before: cashPosition(),
      occurredAt: "2026-07-22T13:19:00.000Z",
    });

    expect(event.payload).toEqual({
      assetId: "asset-1",
      positionId: "cash-1",
      positionKind: "stock",
      instrumentCode: "LEGACY:CASH:CASH-1",
      operation: "deleted",
      previousQuantity: 1,
      currentQuantity: 0,
      evaluatedAmountInWon: 0,
      changedAt: "2026-07-22T13:19:00.000Z",
    });
    expect(Object.values(event.payload)).not.toContain(undefined);
  });
});
