import type {
  RevaluationCommand,
  RevaluedAssetView,
  RevaluedPositionView,
} from "../model/assetRevaluation";
import { calculateAccountValuationPolicy } from "./accountValuation";

export function revaluationCommandFingerprint(
  command: RevaluationCommand,
): string {
  return JSON.stringify({
    householdId: command.householdId,
    assetId: command.assetId,
    expectedAssetVersion: command.expectedAssetVersion,
    operation: command.operation,
    positionId: command.positionId,
    expectedPositionVersion: command.expectedPositionVersion,
    quantity: command.quantity,
    averagePrice: command.averagePrice,
    evaluatedPrice: command.evaluatedPrice,
  });
}

export function revalueAssetFromPositions(input: {
  asset: RevaluedAssetView;
  positions: readonly RevaluedPositionView[];
}): RevaluedAssetView {
  const valuation = calculateAccountValuationPolicy(
    input.positions.map((position) => ({
      positionId: position.positionId,
      kind: "stock" as const,
      quantity: position.quantity,
      averagePrice: position.averagePrice,
      currentPrice: position.evaluatedPrice,
      priceScale: 1,
    })),
  );
  return {
    ...input.asset,
    currentBalance: valuation.currentBalance,
    costBasis: valuation.costBasis,
    aggregateVersion: input.asset.aggregateVersion + 1,
  };
}
