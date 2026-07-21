import type {
  PositionAccountState,
  PositionState,
} from "../model/positionMutation";
import { calculateAccountValuationPolicy } from "./accountValuation";

export function calculatePositionAccountState(input: {
  current: PositionAccountState;
  positions: readonly PositionState[];
}): PositionAccountState {
  const valuation = calculateAccountValuationPolicy(
    input.positions.map((position) => ({
      positionId: position.positionId,
      kind: "stock" as const,
      quantity: position.quantity,
      averagePrice: position.averagePriceInWon,
      currentPrice: position.evaluatedPriceInWon,
      priceScale: 1,
    })),
  );
  return {
    assetId: input.current.assetId,
    currentBalanceInWon: valuation.currentBalance,
    costBasisInWon: valuation.costBasis,
    aggregateVersion: input.current.aggregateVersion + 1,
  };
}
